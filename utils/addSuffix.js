const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

const isLocal = typeof process.pkg === "undefined";
const basePath = isLocal ? process.cwd() : path.dirname(process.execPath);
const layersDir = path.join(basePath, "layers");

// Function to add #1 suffix to all png files in a directory
const addSuffixToPngFiles = (directoryPath) => {
  try {
    // Read all items in the directory
    const items = fs.readdirSync(directoryPath);

    // Process each item
    items.forEach((item) => {
      const itemPath = path.join(directoryPath, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        // If item is a directory, recursively process it
        addSuffixToPngFiles(itemPath);
      } else if (stats.isFile() && path.extname(item).toLowerCase() === ".png") {
        // If item is a PNG file
        const dir = path.dirname(itemPath);
        const ext = path.extname(item);
        let fileName = path.basename(item, ext);
        
        // Skip if the file already has the #1 suffix
        if (fileName.endsWith("#1")) {
          return;
        }
        
        // Create new filename with #1 suffix
        const newFileName = `${fileName}#1${ext}`;
        const newPath = path.join(dir, newFileName);
        
        // Rename the file
        fs.renameSync(itemPath, newPath);
        console.log(chalk.green(`Renamed: ${item} → ${newFileName}`));
      }
    });
  } catch (error) {
    console.error(chalk.red(`Error processing directory ${directoryPath}:`, error));
  }
};

// Main function
const main = () => {
  console.log(chalk.cyan("Starting the process to add #1 suffix to PNG files..."));
  
  try {
    if (!fs.existsSync(layersDir)) {
      console.error(chalk.red(`Layers directory not found at: ${layersDir}`));
      return;
    }
    
    // Get all folders in the layers directory
    const layerFolders = fs.readdirSync(layersDir);
    
    // Process each layer folder
    layerFolders.forEach((folder) => {
      const folderPath = path.join(layersDir, folder);
      const stats = fs.statSync(folderPath);
      
      if (stats.isDirectory()) {
        console.log(chalk.yellow(`Processing layer: ${folder}`));
        addSuffixToPngFiles(folderPath);
      }
    });
    
    console.log(chalk.green("Successfully added #1 suffix to all PNG files in the layers directory!"));
  } catch (error) {
    console.error(chalk.red("An error occurred:", error));
  }
};

// Execute the main function
main(); 