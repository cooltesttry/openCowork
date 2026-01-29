"""
EXIF Orientation Handler

Applies orientation correction based on EXIF data
"""

from PIL import Image
from typing import Optional


# EXIF orientation tag
ORIENTATION_TAG = 274

# Orientation correction operations
ORIENTATION_OPERATIONS = {
    1: [],                                    # Normal
    2: [Image.Transpose.FLIP_LEFT_RIGHT],     # Mirrored horizontal
    3: [Image.Transpose.ROTATE_180],          # Rotated 180
    4: [Image.Transpose.FLIP_TOP_BOTTOM],     # Mirrored vertical
    5: [Image.Transpose.FLIP_LEFT_RIGHT, Image.Transpose.ROTATE_90],  # Mirrored + 90 CCW
    6: [Image.Transpose.ROTATE_270],          # Rotated 90 CW
    7: [Image.Transpose.FLIP_LEFT_RIGHT, Image.Transpose.ROTATE_270], # Mirrored + 90 CW
    8: [Image.Transpose.ROTATE_90],           # Rotated 90 CCW
}


def get_exif_orientation(img: Image.Image) -> Optional[int]:
    """Get EXIF orientation from image"""
    try:
        exif = img.getexif()
        if exif:
            return exif.get(ORIENTATION_TAG)
    except Exception:
        pass
    return None


def apply_orientation_fix(img: Image.Image) -> Image.Image:
    """
    Apply EXIF orientation correction

    Args:
        img: PIL Image

    Returns:
        Orientation-corrected image
    """
    orientation = get_exif_orientation(img)
    if orientation is None or orientation == 1:
        return img

    operations = ORIENTATION_OPERATIONS.get(orientation, [])
    result = img
    for op in operations:
        result = result.transpose(op)

    return result


def needs_orientation_fix(img: Image.Image) -> bool:
    """Check if image needs orientation fix"""
    orientation = get_exif_orientation(img)
    return orientation is not None and orientation != 1
