"""
PWA용 앱 아이콘을 코드로 생성한다(디자이너 리소스 없이 캡슐 알약 모양 심볼).
한 번 만들어두면 재실행할 필요는 없다 - 로고를 바꾸고 싶을 때만 다시 실행.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "icons"
ICON_DIR.mkdir(exist_ok=True)

BG = (37, 99, 235)  # --primary
WHITE = (255, 255, 255)
LIGHT = (219, 234, 254)


def draw_master(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 배경: 둥근 사각형
    radius = size * 0.22
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG)

    # 캡슐(알약) 심볼: 가운데 기준 45도 느낌으로 두 반원 + 사각형을 대각선 배치
    cap_len = size * 0.62
    cap_w = size * 0.24
    cx, cy = size / 2, size / 2

    capsule = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cd = ImageDraw.Draw(capsule)
    left = cx - cap_len / 2
    right = cx + cap_len / 2
    top = cy - cap_w / 2
    bottom = cy + cap_w / 2
    cd.rounded_rectangle([left, top, right, bottom], radius=cap_w / 2, fill=WHITE)
    # 절반은 옅은 색으로 칠해 캡슐 느낌
    cd.rectangle([cx, top, right, bottom], fill=LIGHT)
    cd.rounded_rectangle([left, top, right, bottom], radius=cap_w / 2, outline=WHITE, width=int(size * 0.012))

    capsule = capsule.rotate(-40, resample=Image.BICUBIC, center=(cx, cy))
    img = Image.alpha_composite(img, capsule)
    return img


def main():
    master = draw_master(1024)
    sizes = [512, 192, 180, 32, 16]
    for s in sizes:
        resized = master.resize((s, s), Image.LANCZOS)
        resized.save(ICON_DIR / f"icon-{s}.png")
    # favicon.ico (여러 해상도 포함)
    master.resize((256, 256), Image.LANCZOS).save(
        ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    print(f"저장 완료: {ICON_DIR} + {ROOT / 'favicon.ico'}")


if __name__ == "__main__":
    main()
