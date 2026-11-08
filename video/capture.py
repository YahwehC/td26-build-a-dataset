"""Screenshots of the running app for the demo video (needs the local server on :8765 and Playwright).
Run: python video/capture.py  -> video/assets/app-*.png"""
import pathlib
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/"
OUT = pathlib.Path(__file__).parent / "assets"
OUT.mkdir(exist_ok=True)
FREEZE = "const s=document.createElement('style');s.textContent='*,*::before,*::after{animation-duration:1ms!important;animation-delay:0ms!important}';document.head.appendChild(s)"

with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 960}, device_scale_factor=1.5)
    pg.goto(URL); pg.wait_for_timeout(4200)
    pg.screenshot(path=OUT / "app-3d.png")
    # rounds
    pg.click("#round-control button:has-text('R0')"); pg.wait_for_timeout(900)
    pg.screenshot(path=OUT / "app-r0.png")
    pg.click("#round-control button:has-text('R1')"); pg.wait_for_timeout(900)
    pg.screenshot(path=OUT / "app-r1.png")
    pg.click("#round-control button:has-text('Latest')"); pg.wait_for_timeout(600)
    # details of the Aggie Stop spot
    pg.click(".pin[data-id='S-AS']"); pg.wait_for_timeout(1200)
    pg.screenshot(path=OUT / "app-detail.png")
    # flat view
    pg.click(".tilt-btn"); pg.wait_for_timeout(1900)
    pg.screenshot(path=OUT / "app-2d.png")
    pg.click(".tilt-btn"); pg.wait_for_timeout(1900)
    # vending in 3D
    pg.evaluate("document.querySelector(\".rank\")")
    pg.click(".pin[data-id='V-1']"); pg.wait_for_timeout(1400)
    pg.screenshot(path=OUT / "app-zoom-vending.png")
    pg.evaluate("[...document.querySelectorAll('.pin')].find(p=>p.dataset.id.startsWith('V-') && !p.hidden).click()")
    pg.wait_for_timeout(1000)
    pg.click("#details .btn"); pg.wait_for_timeout(3500)
    pg.screenshot(path=OUT / "app-vending3d.png")
    # phone
    m = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    m.goto(URL); m.wait_for_timeout(3500)
    m.screenshot(path=OUT / "app-phone.png")
    b.close()
print("done", sorted(p.name for p in OUT.glob("app-*.png")))
