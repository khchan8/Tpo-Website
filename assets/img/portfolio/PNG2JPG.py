import os
from tkinter import Tk, filedialog
from PIL import Image, ImageOps

def select_files():
    """Open a file selection dialog and return the selected file paths."""
    root = Tk()
    root.withdraw()  # Hide the root window
    file_paths = filedialog.askopenfilenames(
        filetypes=[("PNG files", "*.png")], title="Select PNG files"
    )
    return file_paths

def convert_png_to_jpg(png_path):
    """Convert a PNG file to JPG with white background."""
    # Open the PNG image
    img = Image.open(png_path)
    
    # Create a white background image
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        background = Image.new('RGB', img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])  # 3 is the alpha channel
        img = background
    else:
        img = img.convert('RGB')
    
    # Get the base name of the file without extension
    base_name = os.path.splitext(png_path)[0]
    
    # Save as JPG
    jpg_path = f"{base_name}.jpg"
    img.save(jpg_path, "JPEG")
    
    print(f"Converted {png_path} to {jpg_path}")

def main():
    png_files = select_files()
    if not png_files:
        print("No files selected")
        return
    
    for png_file in png_files:
        convert_png_to_jpg(png_file)

if __name__ == "__main__":
    main()
