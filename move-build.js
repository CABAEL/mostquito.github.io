import path from 'path';
import fse from 'fs-extra';

const publicPath = '../public/';

// Ensure public folder exists
fse.ensureDirSync(publicPath);

// Move index.html to root
fse.moveSync(path.join(publicPath, 'index.html'), '../index.html', { overwrite: true });

// Optionally remove /dist folder
// fse.removeSync(distPath);

console.log('✅ Build files moved: index.html to root, assets to /public');
