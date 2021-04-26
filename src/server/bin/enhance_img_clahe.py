import numpy as np
import cv2
import sys

def adjust_gamma(image, gamma=1.0):

   invGamma = 1.0 / gamma
   table = np.array([((i / 255.0) ** invGamma) * 255
      for i in np.arange(0, 256)]).astype("uint8")

   return cv2.LUT(image, table)

def enhance_img(data):
	
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
	return cv2.imread(filename)

def write_img(filename, data):
	cv2.imwrite(filename, data)

if __name__ == "__main__":
	
	filename1=sys.argv[1]

	data1 = read_img(filename1)
	data1 = enhance_img(data1)

	write_img(filename1, data1)
