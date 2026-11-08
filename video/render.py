"""Render the demo film: every frame of video/index.html (window.renderAt(t)) captured in headless Chromium and piped
into ffmpeg, then muxed with the voiceover (out/voice.wav) and a soft music bed (out/music.wav, made by music.py).
Needs the local server on :8765 (python -m http.server 8765 from the repo root).
  python video/render.py --stills 3 10 20     # PNG stills at those seconds -> out/still-*.png
  python video/render.py                      # full film -> out/msc-study-guide-demo.mp4"""
import json, pathlib, subprocess, sys

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
OUT = HERE / "out"
URL = "http://127.0.0.1:8765/video/index.html"
FPS = 30


def main():
    args = sys.argv[1:]
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        pg.goto(URL)
        pg.on("pageerror", lambda e: print("PAGE ERROR:", e))
        info = pg.evaluate("window.FILM.ready")
        total = info["total"]
        # morph / landing / click times, used by music.py for the whooshes and pops
        (OUT / "beats.json").write_text(json.dumps(pg.evaluate("window.FILM.beats"), indent=1), encoding="utf-8")
        if args and args[0] == "--stills":
            for s in args[1:]:
                pg.evaluate(f"renderAt({float(s)})")
                pg.screenshot(path=OUT / f"still-{float(s):06.1f}.png")
            print("stills done")
            return
        n = int(round(total * FPS))
        silent = OUT / "picture.mp4"
        ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "image2pipe", "-framerate", str(FPS), "-i", "-",
                               "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", str(silent)],
                              stdin=subprocess.PIPE)
        for i in range(n):
            pg.evaluate(f"renderAt({i / FPS})")
            ff.stdin.write(pg.screenshot(type="jpeg", quality=93))
            if i % 300 == 0:
                print(f"frame {i}/{n}", flush=True)
        ff.stdin.close(); ff.wait()
        b.close()
    final = OUT / "msc-study-guide-demo.mp4"
    music = OUT / "music.wav"
    inputs = ["-i", str(silent), "-i", str(OUT / "voice.wav")]
    if music.exists():
        inputs += ["-i", str(music)]
        mix = "[1:a]volume=1.0[v];[2:a]volume=1.0[m];[v][m]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]"
    else:
        mix = "[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]"
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", mix, "-map", "0:v", "-map", "[a]",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", str(final)], check=True)
    print("wrote", final, f"{total:.1f} s")


main()
