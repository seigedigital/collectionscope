#!/bin/bash

folders=( "./apps/" "./audio/" "./css/" "./fonts/" "./img/" "./js/" )

for f in ${folders[@]}; do
  echo $f
  scp -rp $f root@manducus.net:/home/seige/manducus/www/mkgcs/
done
