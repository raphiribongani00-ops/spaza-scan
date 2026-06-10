const QRCode = require('qrcode');

// Generate QR code as data URL (for displaying in HTML)
async function generateQRCode(text) {
    try {
        const qrCodeDataURL = await QRCode.toDataURL(text, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
        return qrCodeDataURL;
    } catch (err) {
        console.error('QR generation error:', err);
        return null;
    }
}

// Generate QR code as buffer (for saving or downloading)
async function generateQRCodeBuffer(text) {
    try {
        const buffer = await QRCode.toBuffer(text, {
            width: 300,
            margin: 2
        });
        return buffer;
    } catch (err) {
        console.error('QR buffer error:', err);
        return null;
    }
}

module.exports = { generateQRCode, generateQRCodeBuffer };