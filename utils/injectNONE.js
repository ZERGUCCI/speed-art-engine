const fs = require('fs');
const path = require('path');

const LAYERS_DIR = path.join(__dirname, 'layers');

// Create a simple transparent PNG or use an existing one
function getTransparentPNG() {
  console.log('Setting up transparent NONE.png template...');
  const templatePath = path.join(__dirname, 'NONE_template.png');
  
  // Check if the template already exists
  if (fs.existsSync(templatePath)) {
    console.log('Using existing template at:', templatePath);
    return templatePath;
  }
  
  // Create a minimal valid transparent PNG (1x1 pixel)
  // This is a hardcoded binary for a transparent 1x1 PNG
  const transparentPngData = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
    0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
  
  fs.writeFileSync(templatePath, transparentPngData);
  console.log('Created new template at:', templatePath);
  return templatePath;
}

// Add weight suffix to files that don't already have one
function addWeightSuffixToFiles() {
  console.log('Adding weight suffixes to files...');
  
  // Get all subdirectories in the layers directory
  const layerFolders = fs.readdirSync(LAYERS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  let totalModified = 0;
  
  // Process each layer folder
  layerFolders.forEach(folderName => {
    const folderPath = path.join(LAYERS_DIR, folderName);
    
    // Get all PNG files in the folder
    const files = fs.readdirSync(folderPath)
      .filter(file => file.toLowerCase().endsWith('.png') && !file.startsWith('NONE'));
    
    // Add weight to files that don't have it
    files.forEach(file => {
      // Check if file already has a weight suffix (#number)
      if (!file.includes('#')) {
        const filePath = path.join(folderPath, file);
        const fileName = file.substring(0, file.length - 4); // Remove .png
        const newFileName = `${fileName}#1.png`;
        const newFilePath = path.join(folderPath, newFileName);
        
        // Rename the file
        fs.renameSync(filePath, newFilePath);
        console.log(`Added weight to: ${file} → ${newFileName}`);
        totalModified++;
      }
    });
  });
  
  console.log(`Added weight suffixes to ${totalModified} files.`);
}

// Calculate the appropriate weight for NONE based on desired probability
function calculateNONEWeight(folderPath, desiredNONEProb) {
  // Get all PNG files in the folder
  const files = fs.readdirSync(folderPath)
    .filter(file => file.toLowerCase().endsWith('.png') && !file.startsWith('NONE'));
  
  let totalWeight = 0;
  
  // Calculate total weight of existing files
  files.forEach(file => {
    const match = file.match(/#(\d+)/);
    const weight = match ? parseInt(match[1]) : 1; // Default weight is 1 if not specified
    totalWeight += weight;
  });
  
  // Calculate NONE weight based on desired probability
  // If we want NONE to have 30% probability, and existing files have 70% total,
  // then NONE weight should be (30/70) * totalWeight
  const noneProb = desiredNONEProb / 100;
  const existingProb = 1 - noneProb;
  
  if (existingProb === 0) return 1; // Avoid division by zero
  
  const noneWeight = Math.round((noneProb / existingProb) * totalWeight);
  return noneWeight;
}

// Add NONE.png to a folder with the specified weight
function addNONEToFolder(folderPath, noneWeight, templatePath) {
  const nonePath = path.join(folderPath, `NONE#${noneWeight}.png`);
  
  // Check if NONE.png already exists
  if (fs.existsSync(nonePath)) {
    console.log(`NONE#${noneWeight}.png already exists in ${folderPath}`);
    return;
  }
  
  fs.copyFileSync(templatePath, nonePath);
  console.log(`Added NONE#${noneWeight}.png to ${folderPath}`);
}

// Create duplicate folders for multiple instances
function createDuplicateFolder(originalFolder, newName, noneProb = null) {
  const originalPath = path.join(LAYERS_DIR, originalFolder);
  const newPath = path.join(LAYERS_DIR, newName);
  
  // Create the new folder if it doesn't exist
  if (!fs.existsSync(newPath)) {
    console.log(`Creating new folder: ${newName}`);
    fs.mkdirSync(newPath, { recursive: true });
    
    // Copy all files from original folder to new folder
    const files = fs.readdirSync(originalPath)
      .filter(file => file.toLowerCase().endsWith('.png') && !file.startsWith('NONE'));
    
    files.forEach(file => {
      fs.copyFileSync(path.join(originalPath, file), path.join(newPath, file));
    });
    
    console.log(`Created duplicate folder: ${newName}`);
  } else {
    console.log(`Folder ${newName} already exists, skipping creation`);
  }
  
  // If noneProb is specified, add NONE.png to the new folder
  if (noneProb !== null) {
    const weight = calculateNONEWeight(newPath, noneProb);
    addNONEToFolder(newPath, weight, templatePath);
  }
  
  return newPath;
}

// Main execution
console.log('Starting layer processing...');

// STEP 1: Add weight suffixes to all files
addWeightSuffixToFiles();

// STEP 2: Get template for NONE.png
const templatePath = getTransparentPNG();

// STEP 3: Process layers according to requirements

// 1. Big labels (20% chance of appearing, 80% NONE)
const bigLabelsPath = path.join(LAYERS_DIR, 'big labels__z25');
const bigLabelsNONEWeight = calculateNONEWeight(bigLabelsPath, 80);
addNONEToFolder(bigLabelsPath, bigLabelsNONEWeight, templatePath);

// 2. Bigger misc (70% chance of appearing, 30% NONE)
const biggerMiscPath = path.join(LAYERS_DIR, 'bigger misc__z35');
const biggerMiscNONEWeight = calculateNONEWeight(biggerMiscPath, 30);
addNONEToFolder(biggerMiscPath, biggerMiscNONEWeight, templatePath);

// 3. Sticker 1 (50% chance, 1-2x)
const sticker1Path = path.join(LAYERS_DIR, 'sticker1__z40');
const sticker1NONEWeight = calculateNONEWeight(sticker1Path, 50);
addNONEToFolder(sticker1Path, sticker1NONEWeight, templatePath);
// Create second sticker1 folder
createDuplicateFolder('sticker1__z40', 'sticker1_second__z41', 50);

// 4. Sticker 2 (50% chance, 1-2x)
const sticker2Path = path.join(LAYERS_DIR, 'sticker2__z30');
const sticker2NONEWeight = calculateNONEWeight(sticker2Path, 50);
addNONEToFolder(sticker2Path, sticker2NONEWeight, templatePath);
// Create second sticker2 folder
createDuplicateFolder('sticker2__z30', 'sticker2_second__z31', 50);

// 5. Confetti (guaranteed 1x, possibility for 2-4x with 50% chance each)
// Create 3 additional confetti folders with 50% NONE
createDuplicateFolder('confetti__z55', 'confetti_second__z56', 50);
createDuplicateFolder('confetti__z55', 'confetti_third__z57', 50);
createDuplicateFolder('confetti__z55', 'confetti_fourth__z58', 50);

console.log('All NONE.png files have been injected successfully!'); 