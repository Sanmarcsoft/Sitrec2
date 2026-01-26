# What's New in Sitrec

<!--
## AI Instructions for Updating This Document

When updating this changelog:

1. **Get recent commits**: Run `git log --since="[date]" --pretty=format:"%h|%ad|%s" --date=short` from the sitrec directory
2. **Get version tags**: Run `git tag -l "2.*" --sort=-version:refname --format='%(refname:short)|%(creatordate:short)' | head -20`
3. **Organize by version**: Group commits between version tag dates
4. **Categorize entries**:
   - **New Features**: New functionality, UI additions, new file format support
   - **Improvements**: Enhancements to existing features, performance, UX improvements
   - **Bug Fixes**: Entries starting with "Fixed", "Fix", corrections to existing behavior
5. **Write clean descriptions**: Convert commit messages to user-friendly descriptions. Look at actual code changes if the commit message is unclear.
6. **Format**: Use present tense, focus on user benefit, be concise
7. **Add new versions at the top** of the document, below the AI instructions
8. **Include the date** with each version heading

Example entry format:
## Version X.Y.Z (YYYY-MM-DD)

### New Features
- Feature description focusing on what users can now do

### Improvements  
- Enhancement description

### Bug Fixes
- Fixed issue description
-->

---

## Version 2.25.10 (2026-01-26)

### New Features
- **Help Menu Search**: Search box in the Help menu allows searching all menu items across all menus. Type to filter, hover or use arrow keys to preview items in their menus with highlighting, click or press Enter to select. Tooltips are shown for items that have them.
- **Video in Frustum**: Display video texture directly on the camera frustum
- **Slider Settings Menu**: Right-click on any slider to adjust min, max, and step values for more precision
- **Free Transform for Overlays**: More flexible positioning of ground overlays

### Improvements
- Better TIFF support for files without geolocation data
- Deterministic flash offset based on light ID for consistent strobe timing

### Bug Fixes
- Fixed JSON parsing of sitch file names returning numbers instead of strings

---

## Version 2.25.9 (2026-01-24)

### New Features
- **Customizable Aircraft Strobe Offset**: Random or user-defined strobe offset so aircraft lights can flash at different times
- **Camera Offset Control**: Added customizable camera offset ±10°
- **Elevated Overlays**: Overlays can now be elevated for use as clouds
- **Cloud Extraction**: Extract cloud overlays from ground overlays
- **Context Menu for Overlays**: Right-click on overlay to edit or exit edit mode

### Improvements
- **QuickFetch with Chunked Downloads**: Improved loading of larger S3 files with DB caching
- Improved loading manager
- Highlight borders around overlays to help finding them on the map
- Full GeoTIFF location format support via proj4-fully-loaded
- Rendering camera detached from pod head for better custom code compatibility
- Added terrain to SitGimbal with customization options
- Legacy sitch compatibility patches
- Short names for overlays with cloud feathering
- Auto-lock overlay when dragging in KMZ or GeoTIFF
- Exit one edit mode when starting another
- Navigate to overlay when drag and dropped

### Bug Fixes
- Fixed menu mirroring issues
- Fixed GeoTIFF and overlay handling
- Don't create control points when locked

---

## Version 2.25.8 (2026-01-22)

### Bug Fixes
- Fixed visibility of object3D labels, measurement labels, and feature labels with new overlay label system

---

## Version 2.25.7 (2026-01-22)

### New Features
- **3D Object Labels**: Labels for planes and other 3D objects
- **Label Toggle**: Toggle labels visibility in look and main views

### Improvements
- Undo/Redo support for more operations

---

## Version 2.25.6 (2026-01-22)

### Improvements
- Satellite arrows now use same visibility settings as labels

### Bug Fixes
- Fixed satellite visibility rendering in look view

---

## Version 2.25.5 (2026-01-22)

### New Features
- **Lit Only filter** for satellite labels to show only sun-illuminated satellites
- **Look View Visible Only filter** for main view satellite labels

### Improvements
- Satellite arrows now use same visibility settings as labels
- Backwards compatibility patch for satellite display range in older saves

### Bug Fixes
- Fixed overlay memory leak
- Fixed satellite visibility rendering in look view

---

## Version 2.25.4 (2026-01-22)

### Improvements
- **Replaced sprite text with overlay text** for labels - higher resolution and simpler rendering
- Increased default ambient lighting from 0.2 to 0.3

### Bug Fixes
- Fixed labeled arrows displaying at wrong end for celestial objects

---

## Version 2.25.3 (2026-01-21)

### Improvements
- Satellite display range now defaults to 100,000m
- Ignore satellites with TLE data more than 90 days out of date

### Bug Fixes
- Fixed satellite cutoff value to match previous behavior
- Fixed interpolation continuing when paused

---

## Version 2.25.2 (2026-01-21)

### Improvements
- **Improved satellite rendering** with refactored point light cloud system
- Satellite labels now limited to N closest satellites per view to prevent browser crashes
- Better satellite brightness range in main view
- Main view satellites size-attenuated by distance while remaining visible when zoomed out
- Separated brightness calculation (sun illumination) from view-specific size attenuation
- Stars rendered without subpixel flickering using minimum size and alpha blending
- Saved sitches now correctly restore exact camera orientation via local up vector serialization

### Bug Fixes
- Fixed right-click context menu on satellites and stars
- Fixed jerky satellite motion when playing at 20x+ speed
- Fixed stand-alone video viewer issues

---

## Version 2.24.2 (2026-01-20)

### New Features
- **HEVC/H.265 video support** with improved error handling
- **Rotated video support** for properly oriented playback

### Improvements
- Stand-alone LOS view now supports drag-and-drop
- Admin debug dashboard improvements

---

## Version 2.24.1 (2026-01-19)

### New Features
- **Version history menu** for loading previous saves of a sitch
- **Spline2 spline type** for manual tracking curves

### Improvements
- Improved default spline parameters
- Sitches in load menu now sorted by last save date instead of creation date
- File content hash calculation moved client-side to work with S3 presigned URLs

---

## Version 2.24.0 (2026-01-19)

### New Features
- **SubSitches** for saving and restoring sub-states within a sitch
- **Multi-video handling** with support for multiple video files
- **Video loading manager** displaying loading status of videos

### Improvements
- Improved shift-dragging to rotate camera (prevents glitching at zenith, avoids going underground)
- Double-click Sub triggers rename
- SubSitch details for selecting what is saved and restored
- Saving more metadata with file types including original origin from KML overlays
- Dialog for choosing between video image or image overlay

### Bug Fixes
- Fixed issues with async loading of multiple videos/images
- Fixed ground overlay corner dragging
- Skip "video/image is already loaded" dialog when loading TS file from sitch

---

## Version 2.23.0 (2026-01-17)

### New Features
- **GeoTiff support** for loading GeoTiff image files
- **Image ground overlays** integrated with tile system
- **KMZ file support** with embedded images (e.g., from NASA Worldview/EODIS)
- **Zaine Triangulation** for Gimbal analysis (in Show/Hide menu)
- **Admin DAG view** for node tree visualization

### Bug Fixes
- Fixed z-fighting with custom z-bias for overlay seams
- Fixed async visibility issue
- Fixed initial rotation handles
- Improved overlay visibility

---

## Version 2.22.2 (2026-01-16)

### New Features
- **PBA track importing** for Pico Balloon Archive data

### Improvements
- Great circle interpolation for display of large missing track chunks
- PBA tracks use "balloon_callsign" if available
- Exporting legacy tracks (e.g. Gimbal) as MISB compliant
- Increased video load timeout to 2 minutes

### Bug Fixes
- Fixed missing settings with server sanitization validation

---

## Version 2.22.1 (2026-01-16)

### Improvements
- Updated documentation

---

## Version 2.22.0 (2026-01-16)

### New Features
- **Cloud layers** with sprite-based rendering, proper lighting, and wind-driven animation
- **Feathered cloud edges** with randomized wiggled borders for realistic appearance
- **Cloud drag handles** for intuitive positioning and scaling in the scene

### Improvements
- Clouds conform to earth curvature creating realistic "cloud horizon" for flat cloud banks
- Optimized cloud rendering with comb sort for proper transparency ordering
- Optimized cloud mesh generation for better performance
- Panorama export now starts motion analysis automatically
- Cloud GUI matches building controls for consistency

---

## Version 2.21.0 (2026-01-14)

### New Features
- **Depth velocity traversal** using manual tracking with optimization for ground speed vs air speed
- **Multiple manual curve types** with linear segmented curves for testing
- **MISB track exporting** for minimally-compliant tracks that can be reimported
- **Compass tool** for mobile devices
- **Align with Flow** option to rotate overlays based on motion direction
- **Remove Outer Black** video processing option
- **Speed overlay** display
- **Flowgen tool** to generate scrolling fuzzy backgrounds for testing motion analysis

### Improvements
- Optimized flow orbs by reusing Three.js vectors
- Increased max satellite brightness to 50 (was 6)
- Force settings to default for visual regression tests
- Video resize now uses original dimensions for consistency across users
- Resample audio to 48K if not a common format (48K or 44.1K)
- Flow orbs working in Legacy Gimbal sitch with different camera matrix
- Legacy gimbal sphere visible in look view for better visibility

### Bug Fixes
- Fixed focus issues with GUI mousing out of input boxes
- Fixed typo (choise → choice) preventing early return optimization
- Fixed exporting of Gimbal viewport
- Fixed viewport resizing when changing presets

---

## Version 2.20.1 (2026-01-06)

### Improvements
- Panorama frame step control for more precise panorama creation
- Improved subpixel tracking for slow movement (panning)
- Using actual values (not smoothed) for panorama motion
- Using effects in panorama rendering
- Code consolidation with DRY utility functions

### Bug Fixes
- Fixed mouse scroll wheel leaking through GUI to video zoom
- Fixed skipping frames on panorama export
- Fixed multiple Masking menus bug
- Fixed OpenCV loading issue

---

## Version 2.20.0 (2026-01-04)

### New Features
- **Animated panorama exporting** for video-based 360-degree views
- **Auto masking** for motion analysis regions
- **Multiple motion analysis techniques** with selectable methods
- **Motion analysis cache status indicator** with automatic frame advance until cache is full
- **Automatic encoding fallback** to software encoding when hardware encoding fails
- **Chatbot documentation access** allowing AI assistant to reference docs

### Improvements
- Renamed "Pano Video" to "Animated Pano" for clarity
- Better interpolating over gaps and smoothing with incomplete data
- Much more accurate linear tracklet method for motion tracking
- Using last-known-good frame to handle frames with no tracking data
- Prefer software WebM encoding on Firefox for better compatibility
- Added **Sitch Duration** field in Time menu showing duration as HH:MM:SS.sss
- Elastic GUI sliders now expand their range when typing a value outside the current range
- Basic panorama exporting for 360-degree views

### Bug Fixes
- Fixed motion analysis menu loading on older sitches
- Fixed startup frame issues
- Fixed motion tracking using incorrect frames if frame not yet loaded
- Fixed motion tracking arrows not redrawing when paused and resizing
- Fixed WebM exporter
- Fixed panorama creation using video playback correctly
- Fixed menu position jumping in legacy sitches when hiding empty menus

---

## Version 2.19.6 (2026-01-01)

### New Features
- **MP4 video export** using native browser encoding via MediaBunny
- **4K video export** support (if browser supports it)
- **OpenCV integration** for video motion analysis with background direction detection
- **Motion analysis mask editing** with brush tools for defining analysis regions
- Video export now includes motion analysis overlays
- Added **Enough/Abort button** during video rendering
- Added **watermark** with version and build date to exported videos
- Export videos now render the A-to-B frame range
- Full-screen video export option

### Improvements
- H.264 encoding starts at level 4.1 for maximum compatibility
- Better video render export progress indication
- Reorganized video rendering menu

### Bug Fixes
- Fixed frame slider going one past the end of the video
- Fixed jittery labels on video export
- Fixed OpenCV crash
- Removed sliders from Lat/Lon inputs
- Fixed resize handles appearing when editing video analysis mask
- Fixed fullscreen video issues
- Fixed WebM encoding for fractional framerates
- Fixed video creator changing visibility of separate overlays

---

## Version 2.19.5 (2026-01-01)

### New Features
- **Export Look View Video** option for recording the camera view
- Optional Retina resolution export for higher quality videos
- Select between Main View or Look View for video export

### Improvements
- Better check for pending video frames for more deterministic regression tests

### Bug Fixes
- Fixed jerky Gimbal video recording
- Fixed double numbers appearing in speed graph

---

## Version 2.19.4 (2026-01-01)

### Improvements
- Retrying space-track if recent TLEs fail to load, with progress indicator
- Admin validation of all saved sitches

---

## Version 2.19.3 (2025-12-29)

### New Features
- **Local NLU parsing** for common chatbot requests with fuzzy typo correction using Levenshtein distance
- Basic usage tracking for tiles and AI features

### Improvements
- More robust JSON parsing
- More secure example getUserIDCustom

### Bug Fixes
- Fixed sitch name validation issues

---

## Version 2.19.2 (2025-12-29)

### Improvements
- Removed unused vendor files and replaced with node modules
- Updated dependencies: jest 29.7.0 to 30.2.0, express 4.22.0 to 5.2.1, mathjs 14.6.0 to 15.1.0, three.js 0.181.2 to 0.182.0, webpack 5.101.3 to 5.104.1

### Bug Fixes
- Fixed GUI menus blocking keyboard input to the application

---

## Version 2.19.1 (2025-12-28)

### New Features
- **STANAG 4676 file importing** with correct camera and target tracks
- **MISB/KLV file support** improvements with CSV variant support

### Improvements
- Track file importing refactored for better multi-track support
- More robust getSitches handling for simultaneous requests
- Additional unit tests for file loading (KML, GeoJSON, SRT, STANAG)

### Bug Fixes
- Fixed "to-target" setting for multi-track imports

---

## Version 2.15.1 (2025-12-09)

### Improvements
- Removed right-click deletion of spline editor points to prevent accidental deletions
- Smoothing for synthetic tracks
- Expanded track time offset range to 600 seconds (10 minutes)

### Bug Fixes
- Fixed orientation controller for synthetic objects
- Fixed distorted MQ9 models at long distances from origin

---

## Version 2.15.0 (2025-12-08)

### New Features
- **Terrain transparency slider** for adjusting terrain opacity
- Configurable sources for Starlink and active satellite data

### Improvements
- More accurate raycasting for LLA positioning to prevent camera going underground
- Changed Draco web workers from CDN to local hosting for better server compatibility
- Restructured documentation with CSS styling for local HTML docs

---

## Version 2.14.2 (2025-12-08)

### New Features
- **Human Horizon controller** for GoFast analysis
- **Sky plot** for celestial view
- **Ephemeris view** with aligned columns
- **ACTIVE satellite source** from Celestrak
- **Export TLE button** for saving satellite data

### Improvements
- Better event calculations for celestial objects
- VIS/etc calculations for visual ephemeris

---

## Version 2.14.1 (2025-12-08)

### New Features
- Save and load terrain layers (e.g., for NRL WMTS)
- Handle serializing sitches with local folder .TS video files

### Bug Fixes
- Fixed various .TS file rehosting issues

---

## Version 2.14.0 (2025-12-03)

### New Features
- **XML STANAG 4676 file parsing** framework
- Basic XML position track loading
- KML track loading encapsulation

### Improvements
- Restructured track file import logic for more source formats
- Only set terrain material transparency when opacity < 1 to avoid render overhead

---

## Version 2.13.0 (2025-11-28)

### New Features
- **WebXR VR support** for desktop VR headsets via navigator.xr.isSessionSupported()

### Improvements
- Correctly snap to ground with keyboard shortcuts when position mode is AGL
- VR emulator excluded from production builds

### Bug Fixes
- Fixed background flow indicator on GoFast

---

## Version 2.12.0 (2025-11-25)

### New Features
- **Satellite flare prediction bands** showing where Starlink flares are visible
- **Frame scrubbing with mouse wheel** in video overlay

### Improvements
- Smooth motion for arrow indicators and flare lines
- Refined flare band accuracy to match actual reflections

---

## Version 2.11.0 (2025-11-17)

### New Features
- **Curve smoothing controls** with user-defined points and tension
- **Synthetic object creation** with position presets
- **Dark/Light theme support** for chat interface
- **Chat history navigation** with up/down arrows

### Improvements
- Better AI handling of complex function calls
- Track smoothing with configurable parameters
- Improved AI system prompts for more concise answers

### Bug Fixes
- Fixed ATFLIR overlay control visibility
- Fixed smoothing crashing with small number of frames
- Fixed curve editing with updated control points

---

## Version 2.10.0 (2025-11-12)

### New Features
- **AI Assistant chatbot** with persistent sessions
- **View presets** for quick layout switching (Main+Look, Video+Look, stacked views)
- **AGL altitude mode** for camera and target positioning

### Improvements
- Better AI handling of menu changes and models
- Rate limiting with user group tiers
- Improved satellite and star scaling consistency

### Bug Fixes
- Fixed tracking node scaling and serialization
- Fixed linear extrapolation of final track segment
- Fixed zooming in Look View

---

## Version 2.9.0 (2025-11-04)

### New Features
- **Wind layer visualization** with animated particles
- **AI-powered scene setup** via natural language
- **Multiple satellite source support** (Celestrak, Space-Track)

### Improvements
- Optimized satellite rendering performance
- Better handling of large satellite catalogs
- Improved wind data loading and caching

### Bug Fixes
- Fixed satellite visibility calculations
- Fixed wind layer transparency issues

---

## Version 2.8.0 (2025-11-02)

### New Features
- **WMTS terrain layer support** for custom map overlays
- **Configurable terrain sources** including NRL layers
- **Satellite magnitude display** showing brightness values

### Improvements
- Better terrain tile loading and caching
- Improved satellite pass predictions

---

## Version 2.7.0 (2025-10-11)

### New Features
- **Custom CSV track import** with flexible column mapping
- **AGL (Above Ground Level) columns** support in track files
- **Geolocation-based startup** using IP location
- **Time zone auto-detection** from client

### Improvements
- Better handling of epoch timestamps in various formats
- Improved startup experience for Starlink sitch
- Cookie-based caching of user location

### Bug Fixes
- Fixed custom CSV tracks with no name field
- Fixed terrain loading before track creation
- Fixed time zone parsing for negative offsets

---

## Version 2.6.0 (2025-10-02)

### New Features
- **FR24 flight data integration** for real aircraft tracks
- **Rubber Duck CSV format** support extracted from FR24

### Improvements
- Better date/time parsing in various formats
- Improved track file detection and loading

---

## Version 2.5.0 (2025-09-08)

### New Features
- **Video object tracking overlay** with movable tracking point
- **Full-screen video toggle** with double-click
- **Mouse wheel zoom** in video view

### Improvements
- Better video playback controls
- Improved overlay visibility management
- Aspect ratio detection for video layout

### Bug Fixes
- Fixed video window initialization
- Fixed tracking overlay coordinate systems

---

## Version 2.4.0 (2025-07-20)

### New Features
- **AI chatbot integration** for natural language scene control
- **Mathematical expressions** in chat commands
- **Camera pointing via RA/Dec** for celestial objects
- **3D aircraft lights** with configurable colors

### Improvements
- Improved time zone handling in chat
- Better geolocation using IP-based lookup
- Dark theme for chat interface

### Bug Fixes
- Fixed button presses getting through chat window
- Fixed paragraphs in chat display

---

## Version 2.3.0 (2025-07-14)

### New Features
- **Flare prediction lines** showing satellite flash directions
- **Satellite arrow indicators** for motion direction

### Improvements
- More accurate flare band positioning
- Smooth animation for indicators

### Bug Fixes
- Fixed geolocation reliability issues
- Fixed drag-and-drop for view presets

---

## Version 2.2.0 (2025-07-13)

### New Features
- **Geolocation startup** for automatic location detection
- **Time zone display** in UI elements
- **3D model lights extraction** from GLTF files

### Improvements
- Better Starlink loading experience
- Expanded flare visibility bands

---

## Version 2.1.0 (2025-07-01)

### New Features
- **Elastic slider controls** for finer parameter adjustment
- **Optional datetime and latlon URL parameters**
- **Touch scroll/zoom disabled** for better mobile experience

### Improvements
- Better control of altitude values with elastic shrinking
- Improved label visibility for satellites

### Bug Fixes
- Fixed filenames ending with user ID not being found
- Fixed tracking default single point positioning
