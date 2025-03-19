"use strict";

const isLocal = typeof process.pkg === "undefined";
const basePath = isLocal ? process.cwd() : path.dirname(process.execPath);
const fs = require("fs");
const path = require("path");
const skiaCanvas = require('skia-canvas');
const createCanvas = (width, height) => new skiaCanvas.Canvas(width, height);
const loadImage = skiaCanvas.loadImage;
const buildDir = `${basePath}/build`;

const { preview } = require(path.join(basePath, "/src/config.js"));

// read json data
const rawdata = fs.readFileSync(`${basePath}/build/json/_metadata.json`);
const metadataList = JSON.parse(rawdata);

const saveProjectPreviewImage = async (_data) => {
  // Extract from preview config
  const { thumbWidth, thumbPerRow, imageRatio, imageName } = preview;
  // Calculate height on the fly
  const thumbHeight = thumbWidth * imageRatio;
  // Prepare canvas
  const previewCanvasWidth = thumbWidth * thumbPerRow;
  const previewCanvasHeight =
    thumbHeight * Math.ceil(_data.length / thumbPerRow);
  // Shout from the mountain tops
  console.log(
    `Preparing a ${previewCanvasWidth}x${previewCanvasHeight} project preview with ${_data.length} thumbnails.`
  );

  // Initiate the canvas now that we have calculated everything
  const previewPath = `${buildDir}/${imageName}`;
  const previewCanvas = createCanvas(previewCanvasWidth, previewCanvasHeight);
  const previewCtx = previewCanvas.getContext("2d");

  // Iterate all NFTs and insert thumbnail into preview image
  // Don't want to rely on "edition" for assuming index
  for (let index = 0; index < _data.length; index++) {
    const nft = _data[index];
    const image = await loadImage(`${buildDir}/images/${nft.edition}.png`);
    previewCtx.drawImage(
      image,
      thumbWidth * (index % thumbPerRow),
      thumbHeight * Math.floor(index / thumbPerRow),
      thumbWidth,
      thumbHeight
    );
  }

  // Write Project Preview to file
  const buffer = await previewCanvas.toBuffer("image/png");
  fs.writeFileSync(previewPath, buffer);
  console.log(`Project preview image located at: ${previewPath}`);
};

saveProjectPreviewImage(metadataList);
