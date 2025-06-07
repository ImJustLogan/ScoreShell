const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

async function updateLoggerImports(dir) {
    const files = await readdir(dir, { withFileTypes: true });
    
    for (const file of files) {
        const fullPath = path.join(dir, file.name);
        
        if (file.isDirectory()) {
            await updateLoggerImports(fullPath);
            continue;
        }
        
        if (!file.name.endsWith('.js')) {
            continue;
        }
        
        try {
            let content = await readFile(fullPath, 'utf8');
            
            // Skip if file doesn't import logger
            if (!content.includes('require.*logger')) {
                continue;
            }
            
            // Update logger import
            content = content.replace(
                /const\s+logger\s*=\s*require\(['"]([^'"]+)['"]\)/g,
                'const { logger } = require(\'$1\')'
            );
            
            await writeFile(fullPath, content);
            console.log(`Updated ${fullPath}`);
        } catch (error) {
            console.error(`Error processing ${fullPath}:`, error);
        }
    }
}

// Start from src directory
updateLoggerImports(path.join(__dirname, '..'))
    .then(() => console.log('Finished updating logger imports'))
    .catch(console.error); 