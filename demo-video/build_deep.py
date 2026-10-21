"""Builds demo-video/demo-deep.mp4 from the full-screen capture of `play JOB`: typing sped up, the agent's wait sped up and captioned.
Usage: python demo-video/build_deep.py <capture.mp4>"""
import subprocess, sys, os

src = sys.argv[1]
WAIT = "Agent working under the Mandate (sped up 8x)"
SEG = [  # (start, end, speed, caption)
    (14, 42, 2.2, None),      # contract, bond, mandate typed
    (42, 51, 2, None),        # the gateway command typed
    (51, 83, 8, WAIT),        # the agent works
    (83, 96, 1, None),        # allowed, refused, summary, the diff
    (96, 105, 1.6, None),     # the 50-run check
    (105, 123, 1.8, None),    # deliver, verify, accept, settle
    (123, 138, 1.4, None),    # credits, the second job, the unfixed check
    (138, 168, 1.4, None),    # reject, panel, ruling, settle, reputation
    (168, 172, 1, None),      # hold on the last frame
]
FONT = "C\:/Windows/Fonts/arial.ttf"
parts, labels = [f"[0:v]fps=30,format=yuv420p,split={len(SEG)}" + "".join(f"[i{k}]" for k in range(len(SEG)))], []
for k, (a, b, sp, cap) in enumerate(SEG):
    f = f"[i{k}]trim={a}:{b},setpts=(PTS-STARTPTS)/{sp}"
    if cap:
        f += (f",drawtext=text='{cap}':fontfile='{FONT}':fontsize=34:fontcolor=white:box=1:"
              f"boxcolor=black@0.7:boxborderw=14:x=(w-text_w)/2:y=h-120")
    parts.append(f + f"[s{k}]"); labels.append(f"[s{k}]")
parts.append("".join(labels) + f"concat=n={len(SEG)}:v=1:a=0[out]")
here = os.path.dirname(os.path.abspath(__file__))
script = os.path.join(here, "deep.filter")
open(script, "w", encoding="utf8").write(";\n".join(parts) + "\n")
out = os.path.join(here, "demo-deep.mp4")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-/filter_complex", script, "-map", "[out]", "-c:v", "libx264",
                "-crf", "24", "-preset", "medium", "-movflags", "+faststart", out], check=True)
os.remove(script)
print(out)
