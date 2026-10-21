"""Builds demo-video/demo-cut.mp4 from the raw captures: trims waits, speeds up typing, adds captions.
Usage: python demo-video/build_cut.py <vid-dir>   (the folder holding p1.mp4, p3.mp4, raw3.mp4)
Segments are (input, start, end, speed, caption). speed > 1 speeds the segment up."""
import subprocess, sys, os

vid = sys.argv[1]
inputs = ["p1.mp4", "p3.mp4", "raw3.mp4"]
WAIT = "Claude Code working under the Mandate (sped up 8x)"
BENCH = "Our own 445 cases - held-out results are on slide 12"
SEG = [
    # status and runtimes (13:31 take)
    (0, 9.8, 11.0, 2, None), (0, 11.0, 14.2, 1, None),
    (0, 16.1, 17.8, 2, None), (0, 17.8, 21.0, 1, None),
    # the governed run, the edit, the record (13:37 take)
    (1, 8.3, 12.3, 2.5, None), (1, 12.3, 24.0, 8, WAIT), (1, 24.0, 31.0, 1, None),
    (1, 35.6, 37.1, 2, None), (1, 37.1, 41.0, 1, None),
    (1, 42.2, 43.7, 2, None), (1, 43.7, 45.7, 1, None),
    (1, 46.8, 47.9, 2, None), (1, 47.9, 52.0, 1, None),
    (1, 53.4, 55.2, 2, None), (1, 55.2, 60.8, 1, None),
    (1, 62.2, 64.0, 2, None), (1, 64.0, 66.0, 1, None),
    (1, 67.1, 67.7, 2, None), (1, 67.7, 73.5, 1, None),
    # the run with the host allowed, then ls, then the benchmark (13:24 take)
    (2, 114.7, 127.5, 5, None), (2, 127.5, 136.2, 8, WAIT), (2, 136.2, 143.0, 1, None),
    (2, 147.0, 149.0, 2, None), (2, 149.0, 153.0, 1, None),
    (2, 153.4, 155.6, 2, None), (2, 155.6, 161.6, 1, None),
]
FONT = "C\\:/Windows/Fonts/arial.ttf"
count = {i: sum(1 for s in SEG if s[0] == i) for i in range(len(inputs))}
parts, used = [], {i: 0 for i in range(len(inputs))}
for i, n in count.items():
    names = "".join(f"[i{i}_{k}]" for k in range(n))
    parts.append(f"[{i}:v]fps=30,format=yuv420p,split={n}{names}" if n > 1 else f"[{i}:v]fps=30,format=yuv420p[i{i}_0]")
labels = []
for idx, (i, a, b, sp, cap) in enumerate(SEG):
    k = used[i]; used[i] += 1
    f = f"[i{i}_{k}]trim={a}:{b},setpts=(PTS-STARTPTS)/{sp}"
    if cap:
        f += (f",drawtext=text='{cap}':fontfile='{FONT}':fontsize=30:fontcolor=white:box=1:"
              f"boxcolor=black@0.65:boxborderw=14:x=40:y=h-90")
    parts.append(f + f"[s{idx}]")
    labels.append(f"[s{idx}]")
parts.append("".join(labels) + f"concat=n={len(SEG)}:v=1:a=0[out]")
script = os.path.join(vid, "cut.filter")
open(script, "w", encoding="utf8").write(";\n".join(parts) + "\n")
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo-cut.mp4")
cmd = ["ffmpeg", "-v", "error", "-y"]
for name in inputs:
    cmd += ["-i", os.path.join(vid, name)]
cmd += ["-/filter_complex", script, "-map", "[out]", "-c:v", "libx264", "-crf", "24", "-preset", "medium",
        "-movflags", "+faststart", out]
subprocess.run(cmd, check=True)
print(out)
