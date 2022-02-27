#!/bin/bash
python scripts/download_images.py \
  -in "output.csv" \
  -image "image" \
  -id "id" \
  -out "./thumbnails/" \
  -threads 2 
