# SAM2 Tracking Service - Installation Guide

SAM2 (Meta's Segment Anything Model 2) provides video-mode mask propagation: given a single click on an object in one frame, it segments and tracks that object across all subsequent frames. This service wraps SAM2 in a FastAPI microservice that Sitrec calls from the browser.

This is a **local dev only** feature. It is not enabled on production.

---

## Architecture

```
Browser (Sitrec JS)
    |
    |--- POST /sam2/track  (video file + click coords)
    |
    v
Web Server (proxy /sam2/ -> 127.0.0.1:8001)
    |  Options:
    |  - Nginx (local dev with local.metabunk.org)
    |  - Webpack dev server (npm start)
    |  - Standalone Express server (npm run dev-standalone)
    |
    v
Python FastAPI Service (sam2_service.py, port 8001)
    |
    |--- ffmpeg: extract video -> JPEG frames
    |--- SAM2 model: propagate mask across frames
    |--- return JSON: [{frame, cx, cy}, ...]
```

The JS frontend uploads the in-memory video file as a multipart form POST via the `/sam2/` proxy path. The web server proxies this to the Python service on port 8001. The Python service saves the video to a temp file, extracts JPEG frames with ffmpeg, runs SAM2 tracking, and returns per-frame centroids. Temp files are cleaned up after each request.

The proxy approach is required because browsers block mixed-content requests (HTTPS page -> HTTP service) and cross-origin fetches. By proxying through the same web server, the browser sees `/sam2/track` as a same-origin request.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Python 3.11+ | SAM2 requires 3.11 or later |
| ffmpeg | Used to extract video frames to JPEG for SAM2 input |
| Git | To clone the SAM2 repo |
| ~1.5 GB disk space | venv (~1 GB) + SAM2 repo (~200 MB) + checkpoint (~176 MB) |
| ~4-6 GB RAM | Peak usage during tracking |

---

## Step 1: Create the Python Virtual Environment

All commands are run from the `sam2-service/` directory inside the sitrec repo.

```bash
cd sam2-service
python3 -m venv venv
source venv/bin/activate
```

Verify Python version (must be 3.11+):

```bash
python3 --version
```

---

## Step 2: Install Python Dependencies

### FastAPI and utilities

```bash
pip install -r requirements.txt
```

This installs: `fastapi`, `uvicorn[standard]`, `python-multipart`, `numpy`.

### PyTorch

**Mac (Apple Silicon - MPS backend):**

```bash
pip install torch torchvision
```

The standard PyTorch build includes MPS (Metal Performance Shaders) support. No special install URL needed.

**Linux (CPU only):**

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

**Linux (CUDA GPU):**

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

---

## Step 3: Clone and Install SAM2

From inside `sam2-service/`:

```bash
git clone https://github.com/facebookresearch/segment-anything-2.git
cd segment-anything-2
pip install -e ".[dev]"
cd ..
```

The `pip install -e` installs SAM2 as an editable package into the venv so `import sam2` works.

---

## Step 4: Download a Model Checkpoint

SAM2 provides four model sizes. Start with **small** (good balance of speed and accuracy):

| Model | Checkpoint size | Config name |
|---|---|---|
| tiny | 38 MB | `sam2.1_hiera_t` |
| **small** (default) | **176 MB** | `sam2.1_hiera_s` |
| base_plus | 160 MB | `sam2.1_hiera_b+` |
| large | 898 MB | `sam2.1_hiera_l` |

**Download only the small checkpoint:**

```bash
cd segment-anything-2/checkpoints
curl -L -O https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
cd ../..
```

Or to download all checkpoints:

```bash
cd segment-anything-2/checkpoints
./download_ckpts.sh
cd ../..
```

To use a different model size, set the `SAM2_MODEL` environment variable when starting the service:

```bash
SAM2_MODEL=tiny ./start.sh     # fastest, least accurate
SAM2_MODEL=small ./start.sh    # default
SAM2_MODEL=large ./start.sh    # most accurate, slowest, needs large checkpoint
```

---

## Step 5: Verify ffmpeg

The service uses ffmpeg to extract video frames. Verify it's installed:

```bash
ffmpeg -version
```

If not installed:

- **Mac:** `brew install ffmpeg`
- **Ubuntu/Debian:** `sudo apt install ffmpeg`

---

## Step 6: Test the Service

Start the service:

```bash
./start.sh
```

In another terminal, test the health endpoint:

```bash
curl http://127.0.0.1:8001/health
```

Expected response:

```json
{"status":"ok","device":"mps","model":"small","model_loaded":false}
```

`device` will be `"mps"` on Apple Silicon Mac, `"cuda"` with a GPU, or `"cpu"` otherwise. `model_loaded` becomes `true` after the first tracking request.

### Test with a video file

```bash
curl -X POST http://127.0.0.1:8001/track \
  -F "video=@/path/to/some/video.mp4" \
  -F "x=100" \
  -F "y=100" \
  -F "frame=0"
```

The first request will take extra time to load the model (~5-10 seconds). Subsequent requests skip model loading.

Expected response: a JSON array of per-frame centroids:

```json
[
  {"frame": 0, "cx": 327.8, "cy": 232.3},
  {"frame": 1, "cx": 323.0, "cy": 236.1},
  ...
]
```

A `cx`/`cy` of `-1.0` means the object was lost on that frame.

---

## Step 7: Configure the Web Server Proxy

The browser needs to reach the SAM2 service via the same origin (protocol + host) to avoid CORS/mixed-content issues. This is done by adding a `/sam2/` proxy rule to your web server.

### Nginx (local dev with local.metabunk.org)

Add this location block inside your HTTPS server block in `/usr/local/etc/nginx/nginx.conf`, **before** the `\.php$` location:

```nginx
# SAM2 tracking service proxy (local dev only)
location /sam2/ {
    proxy_pass http://127.0.0.1:8001/;
    proxy_read_timeout 300s;
    proxy_connect_timeout 10s;
}
```

Then reload Nginx:

```bash
sudo nginx -t && sudo nginx -s reload
```

### Webpack dev server (npm start)

Already configured in `webpack.dev.js` -- no action needed. The proxy rule is:

```js
{ context: ['/sam2/**'], target: 'http://127.0.0.1:8001', pathRewrite: { '^/sam2': '' } }
```

### Standalone server (npm run dev-standalone)

Already configured in `standalone-server.js` -- no action needed.

---

## Step 8: Use in Sitrec

1. Start the SAM2 service: `cd sam2-service && ./start.sh`
2. Start Sitrec dev server (or use existing Nginx setup)
3. In Sitrec, go to **Video > Auto Tracking**
4. Set **Tracking Method** to **SAM2 (Meta)**
5. Click on the object you want to track in the video
6. Click **Start Auto Tracking**

The browser uploads the video to the SAM2 service via the `/sam2/` proxy, which processes it and returns tracked positions. The status in the menu shows "SAM2: Uploading..." then "SAM2: Tracking..." during processing.

**Note:** SAM2 tracking requires a video loaded via drag-and-drop or file picker (so the raw file data is available in memory). URL-only videos are not currently supported for SAM2.

---

## Troubleshooting

### "SAM2 service is not running"

The browser couldn't reach the SAM2 service via `/sam2/health`. Check:
- The SAM2 service is started (`./start.sh`) and running on port 8001
- Your web server has a `/sam2/` proxy rule (see Step 7)
- Test directly: `curl http://127.0.0.1:8001/health`
- Test via proxy: `curl https://local.metabunk.org/sam2/health` (or your dev URL)

### "Address already in use" on port 8001

Another process is using port 8001. Either stop it or use a different port:

```bash
# Find what's using the port
lsof -ti:8001

# Use a different port
./start.sh 8002
```

If using a non-default port, also set `SAM2_PORT=8002` when starting the Sitrec server, or update the proxy config.

### ffmpeg errors

Make sure ffmpeg is installed and on your PATH. Test with:

```bash
ffmpeg -i /path/to/video.mp4 -frames:v 1 /tmp/test.jpg
```

### "No module named 'sam2'"

The SAM2 package isn't installed in the venv. Make sure you ran `pip install -e ".[dev]"` from inside `segment-anything-2/` with the venv activated.

### Slow performance

- First request is slow because the model is loaded into memory (~5-10s)
- Subsequent requests are faster (model stays loaded)
- MPS (Apple Silicon) is ~2-3 frames/sec
- CPU mode is significantly slower (~0.5-1 frames/sec)

| Clip length | Mac (MPS) | Server (CPU) |
|---|---|---|
| 10s @ 30fps (300 frames) | ~2-5 min | ~5-10 min |
| 30s @ 30fps (900 frames) | ~5-15 min | ~15-30 min |
| Short clip (45 frames) | ~18 sec | ~1-2 min |

### CORS / mixed-content errors in browser console

If you see errors like `blocked by CORS policy` or `Mixed Content`, the browser is trying to reach the SAM2 service directly instead of through the proxy. Make sure:
- Your web server has the `/sam2/` proxy configured (see Step 7)
- You reloaded the web server config after adding the proxy rule
- The JS code uses the `/sam2/` path (not a direct `http://` URL)

### "MPSGraph does not support tensor dims larger than INT_MAX"

This happens on Apple Silicon (MPS) when processing long videos. The video frames exceed the MPS tensor size limit. The service already sets `offload_video_to_cpu=True` and `offload_state_to_cpu=True` to work around this. If you still hit this error, make sure you're running the latest `sam2_service.py`.

### Post-processing warning

You may see this warning in the service output:

```
UserWarning: cannot import name '_C' from 'sam2'
Skipping the post-processing step due to the error above.
```

This is safe to ignore. It means the optional C extension for hole-filling wasn't compiled, but tracking results are unaffected.

---

## File Layout

After installation, the `sam2-service/` directory looks like:

```
sam2-service/
  sam2_service.py          # FastAPI service (committed)
  requirements.txt         # Python deps (committed)
  start.sh                 # Startup script (committed)
  INSTALL.md               # This file (committed)
  venv/                    # Python virtual environment (gitignored)
  segment-anything-2/      # Cloned SAM2 repo (gitignored)
    checkpoints/
      sam2.1_hiera_small.pt  # Model checkpoint (gitignored)
    sam2/                    # SAM2 Python package
    ...
  uploads/                 # Temp dir for video processing (gitignored, auto-created)
```

Everything under `venv/`, `segment-anything-2/`, and `uploads/` is gitignored. Only the three source files and this doc are committed.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SAM2_PORT` | `8001` | Port the FastAPI service listens on |
| `SAM2_DIR` | `./segment-anything-2` | Path to the cloned SAM2 repo |
| `SAM2_MODEL` | `small` | Model size: `tiny`, `small`, `base_plus`, or `large` |

---

## Mick's Local Setup (Mac Mini M4)

Specific values from the initial installation on the dev machine:

- **Python:** 3.11.13 (via pyenv)
- **PyTorch:** 2.10.0 (MPS backend)
- **SAM2:** 1.0
- **ffmpeg:** 7.1.1 (via Homebrew)
- **Device:** MPS (Metal Performance Shaders)
- **Checkpoint:** sam2.1_hiera_small.pt (176 MB)
- **Disk usage:** venv ~1.0 GB, SAM2 repo ~368 MB (including checkpoint)
- **Sitrec path:** `/Users/mick/Dropbox/sitrec-dev/sitrec/sam2-service/`
- **Web server:** Nginx with HTTPS via `https://local.metabunk.org`
- **Nginx config:** `/usr/local/etc/nginx/nginx.conf` -- `/sam2/` proxy added to the main HTTPS server block
- **Tested:** 45-frame clip tracked in ~18 seconds; 1785-frame clip works with CPU offloading

Quick start from scratch (all steps combined):

```bash
cd /Users/mick/Dropbox/sitrec-dev/sitrec/sam2-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install torch torchvision
git clone https://github.com/facebookresearch/segment-anything-2.git
cd segment-anything-2 && pip install -e ".[dev]" && cd ..
cd segment-anything-2/checkpoints
curl -L -O https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
cd ../..
./start.sh
```
