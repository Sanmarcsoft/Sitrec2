"""
SAM2 Tracking Service for Sitrec
Runs as a FastAPI microservice alongside the Sitrec dev server.
Accepts a video file upload + click coordinates, runs tracking in background,
and provides a polling endpoint for progress and results.
"""
import os
import shutil
import subprocess
import threading
import uuid
from collections import OrderedDict

import numpy as np
import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

# Determine device
if torch.backends.mps.is_available():
    device = "mps"
elif torch.cuda.is_available():
    device = "cuda"
else:
    device = "cpu"

print(f"[SAM2] Using device: {device}")

# Locate SAM2 repo relative to this file
SAM2_DIR = os.environ.get("SAM2_DIR", os.path.join(os.path.dirname(__file__), "segment-anything-2"))

# Model config - use small by default, override with SAM2_MODEL env var
# Checkpoint names vs config names differ (e.g. "small" -> "s", "tiny" -> "t")
SAM2_MODEL = os.environ.get("SAM2_MODEL", "small")
_MODEL_MAP = {
    "tiny":      ("sam2.1_hiera_t",  "sam2.1_hiera_tiny"),
    "small":     ("sam2.1_hiera_s",  "sam2.1_hiera_small"),
    "base_plus": ("sam2.1_hiera_b+", "sam2.1_hiera_base_plus"),
    "large":     ("sam2.1_hiera_l",  "sam2.1_hiera_large"),
}
_config_name, _ckpt_name = _MODEL_MAP.get(SAM2_MODEL, _MODEL_MAP["small"])
CONFIG_PATH = f"configs/sam2.1/{_config_name}.yaml"
CHECKPOINT_PATH = os.path.join(SAM2_DIR, "checkpoints", f"{_ckpt_name}.pt")

# Temp directory for uploaded videos
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Lazy-load predictor (loaded on first request)
_predictor = None


def get_predictor():
    global _predictor
    if _predictor is None:
        print(f"[SAM2] Loading model from {CHECKPOINT_PATH}...")
        from sam2.build_sam import build_sam2_video_predictor
        _predictor = build_sam2_video_predictor(
            CONFIG_PATH,
            CHECKPOINT_PATH,
            device=device,
        )
        print("[SAM2] Model loaded.")
    return _predictor


app = FastAPI(title="SAM2 Tracking Service")

# Allow CORS from dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job store: job_id -> job state dict
_jobs = {}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": str(device),
        "model": SAM2_MODEL,
        "model_loaded": _predictor is not None,
    }


@app.post("/track")
async def track(
    video: UploadFile = File(...),
    x: float = Form(...),
    y: float = Form(...),
    frame: int = Form(...),
):
    """
    Start a tracking job. Returns a job_id immediately.
    Poll GET /track/{job_id} for progress and results.
    """
    # Save uploaded video to temp file
    job_id = uuid.uuid4().hex[:12]
    ext = os.path.splitext(video.filename or "video.mp4")[1] or ".mp4"
    video_path = os.path.join(UPLOAD_DIR, f"{job_id}{ext}")

    with open(video_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    # Initialize job state
    _jobs[job_id] = {
        "status": "extracting",
        "phase": "Extracting frames",
        "progress": 0,
        "total": 0,
        "results": None,
        "error": None,
    }

    # Run tracking in background thread
    thread = threading.Thread(
        target=_run_tracking_job,
        args=(job_id, video_path, x, y, frame),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/track/{job_id}")
def track_status(job_id: str):
    """
    Poll for tracking job progress.

    Returns:
    - status: "extracting" | "loading" | "tracking" | "complete" | "error"
    - phase: human-readable description of current phase
    - progress: frames processed so far
    - total: total frames
    - results: null until complete, then [{frame, cx, cy}, ...]
    - error: null unless status is "error"
    """
    job = _jobs.get(job_id)
    if job is None:
        return {"status": "error", "error": "Job not found"}
    return job


def _run_tracking_job(job_id, video_path, x, y, frame):
    """Background worker that runs the full tracking pipeline."""
    job = _jobs[job_id]
    frames_dir = video_path.rsplit(".", 1)[0] + "_frames"

    try:
        # Phase 1: Extract frames with ffmpeg
        os.makedirs(frames_dir, exist_ok=True)
        ffmpeg_cmd = [
            "ffmpeg", "-i", video_path,
            "-q:v", "2", "-start_number", "0",
            os.path.join(frames_dir, "%05d.jpg"),
        ]
        print(f"[SAM2] [{job_id}] Extracting frames...")
        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result.stderr}")

        num_frames = len([f for f in os.listdir(frames_dir) if f.endswith(".jpg")])
        print(f"[SAM2] [{job_id}] Extracted {num_frames} frames")

        # Phase 2: Load model (if not already loaded)
        job["status"] = "loading"
        job["phase"] = "Loading model"
        job["total"] = num_frames
        predictor = get_predictor()

        # Phase 3: Load frames with progress tracking
        job["status"] = "loading_frames"
        job["phase"] = "Loading frames"
        job["progress"] = 0
        print(f"[SAM2] [{job_id}] Loading frames into model...")

        with torch.inference_mode():
            # Load frames ourselves so we can report progress
            # (replicates sam2.utils.misc.load_video_frames_from_jpg_images)
            frame_names = sorted(
                [p for p in os.listdir(frames_dir) if p.lower().endswith((".jpg", ".jpeg"))],
                key=lambda p: int(os.path.splitext(p)[0]),
            )
            img_paths = [os.path.join(frames_dir, fn) for fn in frame_names]
            image_size = predictor.image_size
            img_mean = torch.tensor([0.485, 0.456, 0.406], dtype=torch.float32)[:, None, None]
            img_std = torch.tensor([0.229, 0.224, 0.225], dtype=torch.float32)[:, None, None]

            images = torch.zeros(num_frames, 3, image_size, image_size, dtype=torch.float32)
            video_height = video_width = 0
            for n, img_path in enumerate(img_paths):
                img_pil = Image.open(img_path)
                img_np = np.array(img_pil.convert("RGB").resize((image_size, image_size)))
                img_np = img_np / 255.0
                images[n] = torch.from_numpy(img_np).permute(2, 0, 1)
                video_width, video_height = img_pil.size
                job["progress"] = n + 1

            # Normalize
            images -= img_mean
            images /= img_std

            # Build inference_state dict (mirrors SAM2VideoPredictor.init_state)
            compute_device = predictor.device
            state = {
                "images": images,
                "num_frames": num_frames,
                "offload_video_to_cpu": True,
                "offload_state_to_cpu": True,
                "video_height": video_height,
                "video_width": video_width,
                "device": compute_device,
                "storage_device": torch.device("cpu"),
                "point_inputs_per_obj": {},
                "mask_inputs_per_obj": {},
                "cached_features": {},
                "constants": {},
                "obj_id_to_idx": OrderedDict(),
                "obj_idx_to_id": OrderedDict(),
                "obj_ids": [],
                "output_dict_per_obj": {},
                "temp_output_dict_per_obj": {},
                "frames_tracked_per_obj": {},
            }
            # Warm up visual backbone on frame 0
            predictor._get_image_feature(state, frame_idx=0, batch_size=1)

            predictor.add_new_points_or_box(
                state,
                frame_idx=frame,
                obj_id=1,
                points=np.array([[x, y]], dtype=np.float32),
                labels=np.array([1], dtype=np.int32),
            )

            # Phase 4: Propagate (the slow part)
            # SAM2 propagates forward by default. We need both forward and
            # reverse passes to cover the full video when the click isn't on frame 0.
            job["status"] = "tracking"
            job["phase"] = "Tracking"
            job["progress"] = 0
            print(f"[SAM2] [{job_id}] Propagating across {num_frames} frames (click frame={frame})...")

            results_by_frame = {}

            # Forward pass: click frame -> end
            for frame_idx, _, masks in predictor.propagate_in_video(state):
                mask = masks[0].cpu().numpy().squeeze()
                # Mask values are logits: > 0.0 = probability > 50%
                ys, xs = np.where(mask > 0.0)
                if len(xs):
                    cx, cy = float(xs.mean()), float(ys.mean())
                else:
                    cx, cy = -1.0, -1.0
                results_by_frame[frame_idx] = {"frame": frame_idx, "cx": cx, "cy": cy}
                job["progress"] = len(results_by_frame)

            # Reverse pass: click frame -> start (only if click wasn't on frame 0)
            if frame > 0:
                print(f"[SAM2] [{job_id}] Reverse pass: frame {frame} -> 0...")
                for frame_idx, _, masks in predictor.propagate_in_video(state, reverse=True):
                    mask = masks[0].cpu().numpy().squeeze()
                    ys, xs = np.where(mask > 0.0)
                    if len(xs):
                        cx, cy = float(xs.mean()), float(ys.mean())
                    else:
                        cx, cy = -1.0, -1.0
                    # Don't overwrite forward results (forward pass includes the click frame)
                    if frame_idx not in results_by_frame:
                        results_by_frame[frame_idx] = {"frame": frame_idx, "cx": cx, "cy": cy}
                    job["progress"] = len(results_by_frame)

            # Sort results by frame index
            results = [results_by_frame[k] for k in sorted(results_by_frame.keys())]

            valid_count = sum(1 for r in results if r["cx"] >= 0)
            print(f"[SAM2] [{job_id}] Propagation done: {len(results)} frames, {valid_count} with valid masks")

            predictor.reset_state(state)

        # Done
        job["status"] = "complete"
        job["phase"] = "Complete"
        job["progress"] = num_frames
        job["results"] = results
        print(f"[SAM2] [{job_id}] Complete: {len(results)} frames tracked")

    except Exception as e:
        job["status"] = "error"
        job["phase"] = "Error"
        job["error"] = str(e)
        print(f"[SAM2] [{job_id}] Error: {e}")

    finally:
        # Clean up temp files
        if os.path.exists(video_path):
            os.remove(video_path)
        if os.path.exists(frames_dir):
            shutil.rmtree(frames_dir)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("SAM2_PORT", 8001))
    print(f"[SAM2] Starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
