"use strict";

const path = require("path");
const isLocal = typeof process.pkg === "undefined";
const basePath = isLocal ? process.cwd() : path.dirname(process.execPath);
const fs = require("fs");
const keccak256 = require("keccak256");
const chalk = require("chalk");

const skiaCanvas = require('skia-canvas');
const createCanvas = (width, height) => new skiaCanvas.Canvas(width, height);
const loadImage = skiaCanvas.loadImage;

// Add image cache to prevent reloading the same images
const imageCache = new Map();
const cachedLoadImage = async (path) => {
  if (imageCache.has(path)) {
    return imageCache.get(path);
  }
  const image = await loadImage(path);
  imageCache.set(path, image);
  return image;
};

console.log(path.join(basePath, "/src/config.js"));
const {
  background,
  baseUri,
  buildDir,
  debugLogs,
  description,
  emptyLayerName,
  extraAttributes,
  extraMetadata,
  forcedCombinations,
  format,
  hashImages,
  incompatible,
  layerConfigurations,
  layersDir,
  outputJPEG,
  rarityDelimiter,
  shuffleLayerConfigurations,
  startIndex,
  traitValueOverrides,
  uniqueDnaTorrance,
  useRootTraitType,
} = require(path.join(basePath, "/src/config.js"));

// Completely override console.log if not in debug mode
if (!debugLogs) {
  // Store original console functions
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;

  // Override console methods to suppress output
  console.log = function() {
    // Only allow critical error messages
    if (arguments[0] && typeof arguments[0] === 'string' && 
        (arguments[0].includes('Error:') || arguments[0].includes('error:'))) {
      originalError.apply(console, arguments);
    }
  };
  console.info = function() {};
  console.warn = function() {};
  console.error = function(msg) {
    // Keep error logging for actual errors
    originalError.apply(console, arguments);
  };

  // This function will be used to restore console functionality when needed
  global.restoreConsole = function() {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    console.info = originalInfo;
  };
}

const canvas = createCanvas(format.width, format.height);
const ctxMain = canvas.getContext("2d");
ctxMain.imageSmoothingEnabled = format.smoothing;

// Create a reusable element canvas 
const elementCanvas = createCanvas(format.width, format.height);
const elementCtx = elementCanvas.getContext("2d");
elementCtx.imageSmoothingEnabled = format.smoothing;

let metadataList = [];
let attributesList = [];

// when generating a random background used to add to DNA
let generatedBackground;

let dnaList = new Set(); // internal+external: list of all files. used for regeneration etc
let uniqueDNAList = new Set(); // internal: post-filtered dna set for bypassDNA etc.
const DNA_DELIMITER = "*";

const zflag = /(z-?\d*,)/;

const buildSetup = () => {
  if (fs.existsSync(buildDir)) {
    fs.rmdirSync(buildDir, { recursive: true });
  }
  fs.mkdirSync(buildDir);
  fs.mkdirSync(path.join(buildDir, "/json"));
  fs.mkdirSync(path.join(buildDir, "/images"));
};

const getRarityWeight = (_path) => {
  // check if there is an extension, if not, consider it a directory
  const exp = new RegExp(`${rarityDelimiter}(\\d*)`, "g");
  const weight = exp.exec(_path);
  const weightNumber = weight ? Number(weight[1]) : -1;

  if (weightNumber < 0 || isNaN(weightNumber)) {
    return "required";
  }
  return weightNumber;
};

const cleanDna = (_str) => {
  var dna = _str.split(":").shift();
  return dna;
};

const cleanName = (_str) => {
  const hasZ = zflag.test(_str);

  const zRemoved = _str.replace(zflag, "");

  const extension = /\.[0-9a-zA-Z]+$/;
  const hasExtension = extension.test(zRemoved);
  let nameWithoutExtension = hasExtension ? zRemoved.slice(0, -4) : zRemoved;
  var nameWithoutWeight = nameWithoutExtension.split(rarityDelimiter).shift();
  return nameWithoutWeight;
};

const parseQueryString = (filename, layer, sublayer) => {
  const query = /\?(.*)\./;
  const querystring = query.exec(filename);
  if (!querystring) {
    return getElementOptions(layer, sublayer);
  }

  const layerstyles = querystring[1].split("&").reduce((r, setting) => {
    const keyPairs = setting.split("=");
    return { ...r, [keyPairs[0]]: keyPairs[1] };
  }, []);

  return {
    blendmode: layerstyles.blend
      ? layerstyles.blend
      : getElementOptions(layer, sublayer).blendmode,
    opacity: layerstyles.opacity
      ? layerstyles.opacity / 100
      : getElementOptions(layer, sublayer).opacity,
  };
};

/**
 * Given some input, creates a sha256 hash.
 * @param {Object} input
 */
const hash = (input) => {
  const hashable = typeof input === "string" ? JSON.stringify(input) : input;
  return keccak256(hashable).toString("hex");
};

/**
 * Get't the layer options from the parent, or grandparent layer if
 * defined, otherwise, sets default options.
 *
 * @param {Object} layer the parent layer object
 * @param {String} sublayer Clean name of the current layer
 * @returns {blendmode, opacity} options object
 */
const getElementOptions = (layer, sublayer) => {
  let blendmode = "source-over";
  let opacity = 1;
  if (layer.sublayerOptions?.[sublayer]) {
    const options = layer.sublayerOptions[sublayer];

    options.bypassDNA !== undefined ? (bypassDNA = options.bypassDNA) : null;
    options.blend !== undefined ? (blendmode = options.blend) : null;
    options.opacity !== undefined ? (opacity = options.opacity) : null;
  } else {
    // inherit parent blend mode
    blendmode = layer.blend != undefined ? layer.blend : "source-over";
    opacity = layer.opacity != undefined ? layer.opacity : 1;
  }
  return { blendmode, opacity };
};

const parseZIndex = (str) => {
  const z = zflag.exec(str);
  return z ? parseInt(z[0].match(/-?\d+/)[0]) : null;
};

const getElements = (path, layer) => {
  return fs
    .readdirSync(path)
    .filter((item) => {
      const invalid = /(\.ini)/g;
      return !/(^|\/)\.[^\/\.]/g.test(item) && !invalid.test(item);
    })
    .map((i, index) => {
      const name = cleanName(i);
      const extension = /\.[0-9a-zA-Z]+$/;
      const sublayer = !extension.test(i);
      const weight = getRarityWeight(i);

      const { blendmode, opacity } = parseQueryString(i, layer, name);
      //pass along the zflag to any children
      const zindex = zflag.exec(i)
        ? zflag.exec(i)[0]
        : layer.zindex
        ? layer.zindex
        : "";

      const element = {
        sublayer,
        weight,
        blendmode,
        opacity,
        id: index,
        name,
        filename: i,
        path: `${path}${i}`,
        zindex,
      };

      if (sublayer) {
        element.path = `${path}${i}`;
        const subPath = `${path}${i}/`;
        const sublayer = { ...layer, blend: blendmode, opacity, zindex };
        element.elements = getElements(subPath, sublayer);
      }

      // Set trait type on layers for metadata
      const lineage = path.split("/");
      let typeAncestor;

      if (weight !== "required") {
        typeAncestor = element.sublayer ? 3 : 2;
      }
      if (weight === "required") {
        typeAncestor = element.sublayer ? 1 : 3;
      }
      // we need to check if the parent is required, or if it's a prop-folder
      if (
        useRootTraitType &&
        lineage[lineage.length - typeAncestor].includes(rarityDelimiter)
      ) {
        typeAncestor += 1;
      }

      const parentName = cleanName(lineage[lineage.length - typeAncestor]);

      element.trait = layer.sublayerOptions?.[parentName]
        ? layer.sublayerOptions[parentName].trait
        : layer.trait !== undefined
        ? layer.trait
        : parentName;

      const rawTrait = getTraitValueFromPath(element, lineage);
      const trait = processTraitOverrides(rawTrait);
      element.traitValue = trait;

      return element;
    });
};

const getTraitValueFromPath = (element, lineage) => {
  // If the element is a required png. then, the trait property = the parent path
  // if the element is a non-required png. black%50.png, then element.name is the value and the parent Dir is the prop
  if (element.weight !== "required") {
    return element.name;
  } else if (element.weight === "required") {
    // if the element is a png that is required, get the traitValue from the parent Dir
    return element.sublayer ? true : cleanName(lineage[lineage.length - 2]);
  }
};

/**
 * Checks the override object for trait overrides
 * @param {String} trait The default trait value from the path-name
 * @returns String trait of either overridden value of raw default.
 */
const processTraitOverrides = (trait) => {
  return traitValueOverrides[trait] ? traitValueOverrides[trait] : trait;
};

const layersSetup = (layersOrder) => {
  const layers = layersOrder.map((layerObj, index) => {
    return {
      id: index,
      name: layerObj.name,
      blendmode:
        layerObj["blend"] != undefined ? layerObj["blend"] : "source-over",
      opacity: layerObj["opacity"] != undefined ? layerObj["opacity"] : 1,
      elements: getElements(`${layersDir}/${layerObj.name}/`, layerObj),
      ...(layerObj.display_type !== undefined && {
        display_type: layerObj.display_type,
      }),
      bypassDNA:
        layerObj.options?.["bypassDNA"] !== undefined
          ? layerObj.options?.["bypassDNA"]
          : false,
    };
  });

  return layers;
};

const saveImage = async (_editionCount, _buildDir, _canvas) => {
  const buffer = await _canvas.toBuffer(`${outputJPEG ? "image/jpeg" : "image/png"}`, {
    quality: outputJPEG ? 0.9 : undefined, // Configure based on your quality needs
  });
  return new Promise((resolve, reject) => {
    fs.writeFile(
      `${_buildDir}/images/${_editionCount}${outputJPEG ? ".jpg" : ".png"}`,
      buffer,
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

const genColor = () => {
  let hue = Math.floor(Math.random() * 360);
  let pastel = `hsl(${hue}, 100%, ${background.brightness})`;
  // store the background color in the dna
  generatedBackground = pastel; //TODO: storing in a global var is brittle. could be improved.
  return pastel;
};

const drawBackground = (canvasContext, background) => {
  canvasContext.fillStyle = background.HSL ?? genColor();

  canvasContext.fillRect(0, 0, format.width, format.height);
};

const addMetadata = (_dna, _edition, _prefixData) => {
  let dateTime = Date.now();
  const { _prefix, _offset, _imageHash } = _prefixData;

  const combinedAttrs = [...attributesList, ...extraAttributes()];
  const cleanedAttrs = combinedAttrs.reduce((acc, current) => {
    const x = acc.find((item) => item.trait_type === current.trait_type);
    if (!x) {
      return acc.concat([current]);
    } else {
      return acc;
    }
  }, []);

  let tempMetadata = {
    name: `${_prefix ? _prefix + " " : ""}#${_edition - _offset}`,
    description: description,
    image: `${baseUri}/${_edition}${outputJPEG ? ".jpg" : ".png"}`,
    ...(hashImages === true && { imageHash: _imageHash }),
    edition: _edition,
    date: dateTime,
    ...extraMetadata,
    attributes: cleanedAttrs,
    compiler: "HashLips Art Engine - NFTChef fork",
  };
  metadataList.push(tempMetadata);
  attributesList = [];
  return tempMetadata;
};

const addAttributes = (_element) => {
  let selectedElement = _element.layer;
  const layerAttributes = {
    trait_type: _element.layer.trait,
    value: selectedElement.traitValue,
    ...(_element.layer.display_type !== undefined && {
      display_type: _element.layer.display_type,
    }),
  };
  if (
    attributesList.some(
      (attr) => attr.trait_type === layerAttributes.trait_type
    )
  )
    return;
  attributesList.push(layerAttributes);
};

const loadLayerImg = async (_layer) => {
  return new Promise(async (resolve) => {
    try {
      const image = await cachedLoadImage(_layer.path).catch((err) =>
        console.log(chalk.redBright(`failed to load ${_layer.path}`, err))
      );
      resolve({ layer: _layer, loadedImage: image });
    } catch (err) {
      console.log(chalk.redBright(`Error in loadLayerImg for ${_layer.path}:`, err));
      // Resolve with null image to prevent blocking the process
      resolve({ layer: _layer, loadedImage: null });
    }
  });
};

const drawElement = (_renderObject) => {
  // Reuse the element canvas instead of creating a new one each time
  elementCtx.clearRect(0, 0, format.width, format.height);
  
  if (_renderObject.loadedImage) {
    elementCtx.drawImage(
      _renderObject.loadedImage,
      0,
      0,
      format.width,
      format.height
    );
  }

  addAttributes(_renderObject);
  return elementCanvas;
};

const constructLayerToDna = (_dna = [], _layers = []) => {
  const dna = _dna.split(DNA_DELIMITER);
  let mappedDnaToLayers = _layers.map((layer, index) => {
    let selectedElements = [];
    const layerImages = dna.filter(
      (element) => element.split(".")[0] == layer.id
    );
    layerImages.forEach((img) => {
      const indexAddress = cleanDna(img);

      //

      const indices = indexAddress.toString().split(".");
      // const firstAddress = indices.shift();
      const lastAddress = indices.pop(); // 1
      // recursively go through each index to get the nested item
      let parentElement = indices.reduce((r, nestedIndex) => {
        if (!r[nestedIndex]) {
          throw new Error("wtf");
        }
        return r[nestedIndex].elements;
      }, _layers); //returns string, need to return

      selectedElements.push(parentElement[lastAddress]);
    });
    // If there is more than one item whose root address indicies match the layer ID,
    // continue to loop through them an return an array of selectedElements

    return {
      name: layer.name,
      blendmode: layer.blendmode,
      opacity: layer.opacity,
      selectedElements: selectedElements,
      ...(layer.display_type !== undefined && {
        display_type: layer.display_type,
      }),
    };
  });
  return mappedDnaToLayers;
};

/**
 * In some cases a DNA string may contain optional query parameters for options
 * such as bypassing the DNA isUnique check, this function filters out those
 * items without modifying the stored DNA.
 *
 * @param {String} _dna New DNA string
 * @returns new DNA string with any items that should be filtered, removed.
 */
const filterDNAOptions = (_dna) => {
  const filteredDNA = _dna.split(DNA_DELIMITER).filter((element) => {
    const query = /(\?.*$)/;
    const querystring = query.exec(element);
    if (!querystring) {
      return true;
    }
    // convert the items in the query string to an object
    const options = querystring[1].split("&").reduce((r, setting) => {
      const keyPairs = setting.split("=");
      //   construct the object →       {bypassDNA: bool}
      return { ...r, [keyPairs[0].replace("?", "")]: keyPairs[1] };
    }, []);
    // currently, there is only support for the bypassDNA option,
    // when bypassDNA is true, return false to omit from .filter
    return options.bypassDNA === "true" ? false : true;
  });

  return filteredDNA.join(DNA_DELIMITER);
};

/**
 * Cleaning function for DNA strings. When DNA strings include an option, it
 * is added to the filename with a ?setting=value query string. It needs to be
 * removed to properly access the file name before Drawing.
 *
 * @param {String} _dna The entire newDNA string
 * @returns Cleaned DNA string without querystring parameters.
 */
const removeQueryStrings = (_dna) => {
  const query = /(\?.*$)/;
  return _dna.replace(query, "");
};

/**
 * determine if the sanitized/filtered DNA string is unique or not by comparing
 * it to the set of all previously generated permutations.
 *
 * @param {String} _dna string
 * @returns isUnique is true if uniqueDNAList does NOT contain a match,
 *  false if uniqueDANList.has() is true
 */
const isDnaUnique = (_dna = []) => {
  const filtered = filterDNAOptions(_dna);
  return !uniqueDNAList.has(filterDNAOptions(_dna));
};

// Add progress bar functionality
const createProgressBar = (total) => {
  const barLength = 30;
  let current = 0;
  let lastUpdateTime = Date.now();
  
  // Track generation times for better ETA
  const startTime = Date.now();
  const generationTimes = [];
  
  // Format time in minutes and seconds
  const formatTime = (milliseconds) => {
    if (milliseconds < 0) return "calculating...";
    
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    if (minutes === 0) {
      return `${seconds}s`;
    } else {
      return `${minutes}m ${seconds}s`;
    }
  };
  
  // Initial render
  process.stdout.write('\n');
  
  return {
    update: (value) => {
      if (!debugLogs) {
        // Calculate the time taken for this item
        const now = Date.now();
        if (current > 0) {
          const timeTaken = now - lastUpdateTime;
          generationTimes.push(timeTaken);
          
          // Keep all generation times for a more stable average
          // No longer limiting to just recent times
        }
        lastUpdateTime = now;
        
        current = value;
        const percentage = Math.floor((current / total) * 100);
        const filledLength = Math.floor((current / total) * barLength);
        const filled = '█'.repeat(filledLength);
        const empty = '░'.repeat(barLength - filledLength);
        
        // Calculate average time per item based on recent generations
        let timeRemaining = "calculating...";
        if (generationTimes.length > 0) {
          const avgTimePerItem = generationTimes.reduce((sum, time) => sum + time, 0) / generationTimes.length;
          const itemsLeft = total - current;
          const msRemaining = avgTimePerItem * itemsLeft;
          timeRemaining = formatTime(msRemaining);
        }
        
        // Calculate elapsed time
        const elapsedMs = now - startTime;
        const elapsed = formatTime(elapsedMs);
        
        // Force clear any previous content
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(
          `Generating NFTs: [${filled}${empty}] ${percentage}% (${current}/${total}) | Time remaining: ${timeRemaining} | Elapsed: ${elapsed}`
        );
      }
    },
    complete: () => {
      if (!debugLogs) {
        // Clear any partial progress display
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        
        // Calculate total time
        const totalTime = formatTime(Date.now() - startTime);
        
        process.stdout.write(
          chalk.green(`Generation complete: ${total}/${total} NFTs generated successfully! Total time: ${totalTime}\n`)
        );
      }
    }
  };
};

/**
 * given the nesting structure is complicated and messy, the most reliable way to sort
 * is based on the number of nested indecies.
 * This sorts layers stacking the most deeply nested grandchildren above their
 * immediate ancestors
 * @param {[String]} layers array of dna string sequences
 */
const sortLayers = (layers) => {
  const nestedsort = layers.sort((a, b) => {
    const addressA = a.split(":")[0];
    const addressB = b.split(":")[0];
    return addressA.length - addressB.length;
  });

  let stack = { front: [], normal: [], end: [] };
  stack = nestedsort.reduce((acc, layer) => {
    const zindex = parseZIndex(layer);
    if (!zindex)
      return { ...acc, normal: [...(acc.normal ? acc.normal : []), layer] };
    // move negative z into `front`
    if (zindex < 0)
      return { ...acc, front: [...(acc.front ? acc.front : []), layer] };
    // move positive z into `end`
    if (zindex > 0)
      return { ...acc, end: [...(acc.end ? acc.end : []), layer] };
    // make sure front and end are sorted
    // contat everything back to an ordered array
  }, stack);

  // sort the normal array
  stack.normal.sort();

  return sortByZ(stack.front).concat(stack.normal).concat(sortByZ(stack.end));
};

/** File String sort by zFlag */
function sortByZ(dnastrings) {
  return dnastrings.sort((a, b) => {
    const indexA = parseZIndex(a);
    const indexB = parseZIndex(b);
    return indexA - indexB;
  });
}

/**
 * Sorting by index based on the layer.z property
 * @param {Array } layers selected Image layer objects array
 */
function sortZIndex(layers) {
  return layers.sort((a, b) => {
    const indexA = parseZIndex(a.zindex);
    const indexB = parseZIndex(b.zindex);
    return indexA - indexB;
  });
}

const createDna = (_layers) => {
  let dnaSequence = [];
  let incompatibleDNA = [];
  let forcedDNA = [];

  _layers.forEach((layer) => {
    const layerSequence = [];
    pickRandomElement(
      layer,
      layerSequence,
      layer.id,
      incompatibleDNA,
      forcedDNA,
      layer.bypassDNA ? "?bypassDNA=true" : "",
      layer.zindex ? layer.zIndex : ""
    );
    const sortedLayers = sortLayers(layerSequence);
    dnaSequence = [...dnaSequence, [sortedLayers]];
  });
  const zSortDNA = sortByZ(dnaSequence.flat(2));
  const dnaStrand = zSortDNA.join(DNA_DELIMITER);

  return dnaStrand;
};

const writeMetaData = (_data) => {
  fs.writeFileSync(`${buildDir}/json/_metadata.json`, _data);
};

const writeDnaLog = (_data) => {
  fs.writeFileSync(`${buildDir}/_dna.json`, _data);
};

// Batch metadata writes
const metadataQueue = [];
const processMetadataQueue = () => {
  return Promise.all(
    metadataQueue.map(({ edition, metadata, buildDir }) => {
      return new Promise((resolve, reject) => {
        fs.writeFile(
          `${buildDir}/json/${edition}.json`,
          JSON.stringify(metadata, null, 2),
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    })
  );
};

const saveMetaDataSingleFile = (_editionCount, _buildDir) => {
  let metadata = metadataList.find((meta) => meta.edition == _editionCount);
  if (debugLogs) {
    console.log(
      `Writing metadata for ${_editionCount}: ${JSON.stringify(metadata)}`
    );
  }
  
  // Queue metadata for batch writing
  metadataQueue.push({
    edition: _editionCount,
    metadata,
    buildDir: _buildDir
  });
  
  // If queue gets large, process it
  if (metadataQueue.length >= 20) {
    processMetadataQueue().then(() => {
      metadataQueue.length = 0;
    });
  }
};

function shuffle(array) {
  let currentIndex = array.length,
    randomIndex;
  while (currentIndex != 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
  return array;
}

/**
 * Paints the given renderOjects to the main canvas context.
 *
 * @param {Array} renderObjectArray Array of render elements to draw to canvas
 * @param {Object} layerData data passed from the current iteration of the loop or configured dna-set
 *
 */
const paintLayers = (canvasContext, renderObjectArray, layerData) => {
  if (debugLogs) console.log("\nClearing canvas");
  canvasContext.clearRect(0, 0, format.width, format.height);

  const { abstractedIndexes, _background } = layerData;

  renderObjectArray.forEach((renderObject) => {
    canvasContext.globalAlpha = renderObject.layer.opacity;
    canvasContext.globalCompositeOperation = renderObject.layer.blendmode;
    canvasContext.drawImage(
      drawElement(renderObject),
      0,
      0,
      format.width,
      format.height
    );
  });

  if (_background.generate) {
    canvasContext.globalCompositeOperation = "destination-over";
    drawBackground(canvasContext, background);
  }
  
  if (debugLogs) {
    console.log("Editions left to create: ", abstractedIndexes);
  }
};

const postProcessMetadata = (layerData) => {
  const { abstractedIndexes, layerConfigIndex } = layerData;
  // Metadata options
  const savedFile = fs.readFileSync(
    `${buildDir}/images/${abstractedIndexes[0]}${outputJPEG ? ".jpg" : ".png"}`
  );
  const _imageHash = hash(savedFile);

  // if there's a prefix for the current configIndex, then
  // start count back at 1 for the name, only.
  const _prefix = layerConfigurations[layerConfigIndex].namePrefix
    ? layerConfigurations[layerConfigIndex].namePrefix
    : null;
  // if resetNameIndex is turned on, calculate the offset and send it
  // with the prefix
  let _offset = 0;
  if (layerConfigurations[layerConfigIndex].resetNameIndex) {
    _offset = layerConfigurations[layerConfigIndex - 1].growEditionSizeTo;
  }

  return {
    _imageHash,
    _prefix,
    _offset,
  };
};

const outputFiles = async (
  abstractedIndexes,
  layerData,
  _buildDir = buildDir,
  _canvas = canvas
) => {
  const { newDna, layerConfigIndex, progressBar } = layerData;
  
  // Save the canvas buffer to file
  await saveImage(abstractedIndexes[0], _buildDir, _canvas);

  const { _imageHash, _prefix, _offset } = postProcessMetadata(layerData);

  addMetadata(newDna, abstractedIndexes[0], {
    _prefix,
    _offset,
    _imageHash,
  });

  saveMetaDataSingleFile(abstractedIndexes[0], _buildDir);
  
  // Update progress bar if it exists
  if (progressBar) {
    progressBar.update(abstractedIndexes[0] - startIndex + 1);
  } else if (debugLogs) {
    console.log(chalk.cyan(`Created edition: ${abstractedIndexes[0]}`));
  }
};

const startCreating = async (storedDNA) => {
  if (storedDNA) {
    console.log(`using stored dna of ${storedDNA.size}`);
    dnaList = storedDNA;
    dnaList.forEach((dna) => {
      const editionExp = /\d+\//;
      const dnaWithoutEditionNum = dna.replace(editionExp, "");
      uniqueDNAList.add(filterDNAOptions(dnaWithoutEditionNum));
    });
  }
  
  let layerConfigIndex = 0;
  let editionCount = 1;
  let failedCount = 0;
  let abstractedIndexes = [];
  for (
    let i = startIndex;
    i <=
    startIndex +
      layerConfigurations[layerConfigurations.length - 1].growEditionSizeTo -
      1;
    i++
  ) {
    abstractedIndexes.push(i);
  }
  if (shuffleLayerConfigurations) {
    abstractedIndexes = shuffle(abstractedIndexes);
  }
  
  // Create progress bar
  const totalToGenerate = layerConfigurations[layerConfigurations.length - 1].growEditionSizeTo;
  const progressBar = createProgressBar(totalToGenerate);
  
  // Pre-define layers outside the loop to avoid recreating them
  const layersConfigs = layerConfigurations.map(config => 
    layersSetup(config.layersOrder)
  );
  
  // Process in chunks for better memory management
  const CHUNK_SIZE = 10;
  const processChunk = async (indexes, configIndex) => {
    const layers = layersConfigs[configIndex];
    const chunkPromises = [];
    
    for (let i = 0; i < indexes.length; i++) {
      let attempts = 0;
      let newDna;
      do {
        newDna = createDna(layers);
        attempts++;
        if (attempts > uniqueDnaTorrance) {
          if (!debugLogs) global.restoreConsole();
          console.log(
            `\nYou need more layers or elements to grow your edition to ${layerConfigurations[configIndex].growEditionSizeTo} artworks!`
          );
          process.exit();
        }
      } while (!isDnaUnique(newDna));
      
      chunkPromises.push(
        (async () => {
          try {
            let results = constructLayerToDna(newDna, layers);
            
            // Reduce the stacked and nested layer into a single array
            const allImages = results.reduce((images, layer) => {
              return [...images, ...layer.selectedElements];
            }, []);
            
            const loadedElements = await Promise.all(
              sortZIndex(allImages).map(layer => loadLayerImg(layer))
            );
            
            const layerData = {
              newDna,
              layerConfigIndex: configIndex,
              abstractedIndexes: [indexes[i]],
              _background: background,
              progressBar
            };
            
            paintLayers(ctxMain, loadedElements, layerData);
            await outputFiles([indexes[i]], layerData);
            
            // Add to DNA lists
            dnaList.add(
              `${indexes[i]}/${newDna}${
                generatedBackground ? "___" + generatedBackground : ""
              }`
            );
            uniqueDNAList.add(filterDNAOptions(newDna));
            
          } catch (error) {
            if (!debugLogs) global.restoreConsole();
            console.error("Error generating image:", error);
          }
        })()
      );
    }
    
    await Promise.all(chunkPromises);
  };
  
  while (layerConfigIndex < layerConfigurations.length) {
    const config = layerConfigurations[layerConfigIndex];
    const targetCount = config.growEditionSizeTo;
    const remaining = abstractedIndexes.slice(0, targetCount - (editionCount - 1));
    
    // Process in chunks
    for (let i = 0; i < remaining.length; i += CHUNK_SIZE) {
      const chunk = remaining.slice(i, i + CHUNK_SIZE);
      await processChunk(chunk, layerConfigIndex);
    }
    
    editionCount += remaining.length;
    abstractedIndexes = abstractedIndexes.slice(remaining.length);
    layerConfigIndex++;
  }
  
  // Process any remaining metadata
  if (metadataQueue.length > 0) {
    await processMetadataQueue();
  }
  
  // Complete the progress bar
  progressBar.complete();
  
  // Restore original console functionality
  if (!debugLogs) {
    global.restoreConsole();
  }
  
  writeMetaData(JSON.stringify(metadataList, null, 2));
  writeDnaLog(JSON.stringify([...dnaList], null, 2));
};

// expecting to return an array of strings for each _layer_ that is picked,
// should be a flattened list of all things that are picked randomly AND required
/**
 *
 * @param {Object} layer The main layer, defined in config.layerConfigurations
 * @param {Array} dnaSequence Strings of layer to object mappings to nesting structure
 * @param {Number*} parentId nested parentID, used during recursive calls for sublayers
 * @param {Array*} incompatibleDNA Used to store incompatible layer names while building DNA
 * @param {Array*} forcedDNA Used to store forced layer selection combinations names while building DNA
 * @param {Int} zIndex Used in the dna string to define a layers stacking order
 *  from the top down
 * @returns Array DNA sequence
 */
function pickRandomElement(
  layer,
  dnaSequence,
  parentId,
  incompatibleDNA,
  forcedDNA,
  bypassDNA,
  zIndex
) {
  let totalWeight = 0;
  // Does this layer include a forcedDNA item? ya? just return it.
  const forcedPick = layer.elements.find((element) =>
    forcedDNA.includes(element.name)
  );
  if (forcedPick) {
    debugLogs
      ? console.log(chalk.yellowBright(`Force picking ${forcedPick.name}/n`))
      : null;
    if (forcedPick.sublayer) {
      return dnaSequence.concat(
        pickRandomElement(
          forcedPick,
          dnaSequence,
          `${parentId}.${forcedPick.id}`,
          incompatibleDNA,
          forcedDNA,
          bypassDNA,
          zIndex
        )
      );
    }
    let dnaString = `${parentId}.${forcedPick.id}:${forcedPick.zindex}${forcedPick.filename}${bypassDNA}`;
    return dnaSequence.push(dnaString);
  }

  if (incompatibleDNA.includes(layer.name) && layer.sublayer) {
    debugLogs
      ? console.log(
          `Skipping incompatible sublayer directory, ${layer.name}`,
          layer.name
        )
      : null;
    return dnaSequence;
  }

  const compatibleLayers = layer.elements.filter(
    (layer) => !incompatibleDNA.includes(layer.name)
  );
  if (compatibleLayers.length === 0) {
    debugLogs
      ? console.log(
          chalk.yellow(
            "No compatible layers in the directory, skipping",
            layer.name
          )
        )
      : null;
    return dnaSequence;
  }

  compatibleLayers.forEach((element) => {
    // If there is no weight, it's required, always include it
    // If directory has %, that is % chance to enter the dir
    if (element.weight == "required" && !element.sublayer) {
      let dnaString = `${parentId}.${element.id}:${element.zindex}${element.filename}${bypassDNA}`;
      dnaSequence.unshift(dnaString);
      return;
    }
    // when the current directory is a required folder
    // and the element in the loop is another folder
    if (element.weight == "required" && element.sublayer) {
      const next = pickRandomElement(
        element,
        dnaSequence,
        `${parentId}.${element.id}`,
        incompatibleDNA,
        forcedDNA,
        bypassDNA,
        zIndex
      );
    }
    if (element.weight !== "required") {
      totalWeight += element.weight;
    }
  });
  // if the entire directory should be ignored…

  // number between 0 - totalWeight
  const currentLayers = compatibleLayers.filter((l) => l.weight !== "required");

  let random = Math.floor(Math.random() * totalWeight);

  for (var i = 0; i < currentLayers.length; i++) {
    // subtract the current weight from the random weight until we reach a sub zero value.
    // Check if the picked image is in the incompatible list
    random -= currentLayers[i].weight;

    // e.g., directory, or, all files within a directory
    if (random < 0) {
      // Check for incompatible layer configurations and only add incompatibilities IF
      // chosing _this_ layer.
      if (incompatible[currentLayers[i].name]) {
        debugLogs
          ? console.log(
              `Adding the following to incompatible list`,
              ...incompatible[currentLayers[i].name]
            )
          : null;
        incompatibleDNA.push(...incompatible[currentLayers[i].name]);
      }
      // Similar to incompaticle, check for forced combos
      if (forcedCombinations[currentLayers[i].name]) {
        debugLogs
          ? console.log(
              chalk.bgYellowBright.black(
                `\nSetting up the folling forced combinations for ${currentLayers[i].name}: `,
                ...forcedCombinations[currentLayers[i].name]
              )
            )
          : null;
        forcedDNA.push(...forcedCombinations[currentLayers[i].name]);
      }
      // if there's a sublayer, we need to concat the sublayers parent ID to the DNA srting
      // and recursively pick nested required and random elements
      if (currentLayers[i].sublayer) {
        return dnaSequence.concat(
          pickRandomElement(
            currentLayers[i],
            dnaSequence,
            `${parentId}.${currentLayers[i].id}`,
            incompatibleDNA,
            forcedDNA,
            bypassDNA,
            zIndex
          )
        );
      }

      // none/empty layer handler
      if (currentLayers[i].name === emptyLayerName) {
        return dnaSequence;
      }
      let dnaString = `${parentId}.${currentLayers[i].id}:${currentLayers[i].zindex}${currentLayers[i].filename}${bypassDNA}`;
      return dnaSequence.push(dnaString);
    }
  }
}

module.exports = {
  addAttributes,
  addMetadata,
  buildSetup,
  constructLayerToDna,
  cleanName,
  createDna,
  DNA_DELIMITER,
  getElements,
  hash,
  isDnaUnique,
  layersSetup,
  loadLayerImg,
  outputFiles,
  paintLayers,
  parseQueryString,
  postProcessMetadata,
  sortZIndex,
  startCreating,
  writeMetaData,
};
