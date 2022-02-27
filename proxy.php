<?php
    $url = $_GET["url"];
    header('Content-Type: image/jpeg');
    echo file_get_contents($url);
?>

