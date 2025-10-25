const { formidable } = require('formidable');
const fs = require('fs');
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('canvas');

// This worker is needed for pdfjs-dist to work in Node.js
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return {
      canvas,
      context,
    };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

// Main handler function
module.exports = async (req, res) => {
  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow any origin
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle pre-flight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Handle POST request
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const form = formidable({});
    const [fields, files] = await form.parse(req);

    const pdfFile = files.pdfFile;

    if (!pdfFile || pdfFile.length === 0) {
      return res.status(400).json({ success: false, error: 'No PDF file uploaded.' });
    }

    const filePath = pdfFile[0].filepath;
    const data = new Uint8Array(fs.readFileSync(filePath));
    const images = [];

    const loadingTask = getDocument({
      data,
      cMapUrl: 'pdfjs-dist/cmaps/',
      cMapPacked: true,
    });

    const pdfDocument = await loadingTask.promise;
    const canvasFactory = new NodeCanvasFactory();

    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 }); // Scale 1.5 for better quality
      const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
      
      const renderContext = {
        canvasContext: canvasAndContext.context,
        viewport,
        canvasFactory,
      };

      await page.render(renderContext).promise;

      // Convert canvas to PNG data URL
      const imageDataUrl = canvasAndContext.canvas.toDataURL('image/png');
      images.push(imageDataUrl);

      // Clean up
      page.cleanup();
      canvasFactory.destroy(canvasAndContext);
    }

    // Clean up the temporary file
    fs.unlinkSync(filePath);

    // Send the images back as Base64 data URLs
    return res.status(200).json({ success: true, images: images });

  } catch (error) {
    console.error('Conversion Error:', error);
    return res.status(500).json({ success: false, error: 'An error occurred during conversion.', details: error.message });
  }
};