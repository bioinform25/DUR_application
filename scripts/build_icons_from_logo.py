"""
icons/logo_source.png(사용자가 디자인한 실제 로고)을 원본으로 삼아 앱 아이콘
세트(favicon, 180/192/512)를 다시 만든다. manifest.json의 "maskable" 아이콘은
OS가 원형/둥근사각형으로 잘라내므로, 로고가 중앙 안전영역(약 70%) 안에 들어오게
정사각형 캔버스에 여백을 두고 배치한다.

일회성 자산 생성 스크립트라 자동화 파이프라인에는 포함하지 않는다.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS_DIR = ROOT / "icons"
SOURCE = ICONS_DIR / "logo_source.png"

# 로고 자체의 배경색(연한 회청색)을 그대로 캔버스 배경으로 써서 경계가 안 보이게 한다.
BG_COLOR = (245, 249, 250)
LOGO_FRACTION = 0.72  # 정사각형 캔버스 대비 로고가 차지할 비율(나머지는 여백)


def make_square_icon(logo: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGB", (size, size), BG_COLOR)
    target_h = int(size * LOGO_FRACTION)
    scale = target_h / logo.height
    target_w = int(logo.width * scale)
    resized = logo.resize((target_w, target_h), Image.LANCZOS)
    x = (size - target_w) // 2
    y = (size - target_h) // 2
    canvas.paste(resized, (x, y), resized if resized.mode == "RGBA" else None)
    return canvas


def main():
    logo = Image.open(SOURCE).convert("RGBA")

    sizes = {
        "icon-512.png": 512,
        "icon-192.png": 192,
        "icon-180.png": 180,
        "icon-32.png": 32,
        "icon-16.png": 16,
    }
    for filename, size in sizes.items():
        icon = make_square_icon(logo, size)
        icon.save(ICONS_DIR / filename)
        print(f"[build_icons] {filename} 생성 완료 ({size}x{size})")

    # favicon.ico는 여러 해상도를 한 파일에 담는다.
    favicon_sizes = [16, 32, 48]
    base = make_square_icon(logo, 256)
    base.save(
        ROOT / "favicon.ico",
        format="ICO",
        sizes=[(s, s) for s in favicon_sizes],
    )
    print("[build_icons] favicon.ico 생성 완료")


if __name__ == "__main__":
    main()
