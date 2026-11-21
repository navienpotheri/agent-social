"""Joins the frames of the HUD replay (docs/prototypes/dk1601/hud/sequence/frame-NN.png, made by scripts/hud-shots.sh) into one short GIF, docs/prototypes/dk1601/hud/hud-replay.gif (register row DK1601).
Run: python scripts/hud-gif.py   (needs Pillow). The frames come from the synthetic demo fleet; nothing here comes from a real organisation."""
import glob
from PIL import Image

frames = sorted(glob.glob("docs/prototypes/dk1601/hud/sequence/frame-*.png"))
images = [Image.open(f).convert("RGB").resize((960, 825)) for f in frames]
images = [i.quantize(colors=96, method=Image.Quantize.MEDIANCUT) for i in images]
images[0].save("docs/prototypes/dk1601/hud/hud-replay.gif", save_all=True, append_images=images[1:], duration=450, loop=0, optimize=True)
print(len(images), "frames")
