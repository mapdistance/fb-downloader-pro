const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

const BIN_DIR = path.join(__dirname, 'bin');
const YTDLP_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

async function installYtDlp() {
  console.log('📥 Installing yt-dlp...');
  
  // Create bin directory
  await fs.ensureDir(BIN_DIR);
  
  // Check if already installed
  if (await fs.pathExists(YTDLP_PATH)) {
    console.log('✅ yt-dlp already installed');
    return;
  }
  
  try {
    // Try pip install first
    console.log('Trying pip install...');
    execSync('pip install yt-dlp', { stdio: 'inherit' });
    console.log('✅ yt-dlp installed via pip');
    return;
  } catch (error) {
    console.log('pip install failed, downloading binary...');
  }
  
  // Download binary
  const platform = process.platform;
  const arch = process.arch;
  
  let downloadUrl;
  if (platform === 'win32') {
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  } else if (platform === 'linux') {
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  } else if (platform === 'darwin') {
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  } else {
    console.error('❌ Unsupported platform:', platform);
    process.exit(1);
  }
  
  console.log('Downloading yt-dlp binary...');
  console.log('URL:', downloadUrl);
  
  const response = await axios({
    method: 'get',
    url: downloadUrl,
    responseType: 'stream'
  });
  
  const writer = fs.createWriteStream(YTDLP_PATH);
  response.data.pipe(writer);
  
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  
  // Make executable on Unix systems
  if (platform !== 'win32') {
    await fs.chmod(YTDLP_PATH, 0o755);
  }
  
  console.log('✅ yt-dlp installed successfully');
}

installYtDlp().catch(error => {
  console.error('❌ Failed to install yt-dlp:', error);
  process.exit(1);
});