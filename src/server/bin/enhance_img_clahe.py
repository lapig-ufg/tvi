import numpy as np
import cv2
import sys

def adjust_gamma(image, gamma=1.0):
    invGamma = 1.0 / gamma
    table = np.array([((i / 255.0) ** invGamma) * 255
        for i in np.arange(0, 256)]).astype("uint8")
    return cv2.LUT(image, table)

def enhance_img(data):
    # Verifica se a imagem tem 3 canais
    if data is None:
        raise ValueError("Input image is empty or could not be loaded.")
    if len(data.shape) != 3 or data.shape[2] != 3:
        raise ValueError(f"Expected a 3-channel image, but got shape: {data.shape}")

    r, g, b = cv2.split(data)

    claheSmall = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(8,8))
    claheBig = cv2.createCLAHE(clipLimit=10.0, tileGridSize=(8,8))

    rl = claheBig.apply(r)
    gl = claheSmall.apply(g)
    bl = claheBig.apply(b)
    limg = cv2.merge((rl, gl, bl))
    limg = adjust_gamma(limg, 1.5)

    return limg

def read_img(filename):
    img = cv2.imread(filename)
    if img is None:
        print(f"Error: Unable to load image from {filename}")
    return img

def write_img(filename, data):
    cv2.imwrite(filename, data)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python enhance_img_clahe.py <image_file>")
        sys.exit(1)

    filename1 = sys.argv[1]

    # Carrega a imagem
    data1 = read_img(filename1)
    if data1 is None:
        sys.exit(1)

    # Tenta melhorar a imagem
    try:
        data1 = enhance_img(data1)
        # Salva a imagem melhorada
        write_img(filename1, data1)
    except ValueError as e:
        # Ignora o erro e não faz nada
        pass
