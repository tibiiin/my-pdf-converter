const express = require('express');
const multer = require('multer');
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('canvas');
const JSZip = require('jszip');
const cors = require('cors'); // <-- CRITICAL: For cross-domain requests

// --- Polyfill for pdf.js in Node.js environment ---
// This is necessary to make pdf.js work on a server
class NodeCanvasFactory {
    create(width, height) {
        const canvas = createCanvas(width, height);
        const context = canvas.getContext("2d");
        return { canvas, context };
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
// ---------------------------------------------------

const app = express();
const port = process.env.PORT || 3001;

// --- Middleware ---
// 1. Enable CORS for all origins (you can restrict this to your Vercel URL later)
app.use(cors());
// 2. Set up multer for file uploads in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- Routes ---
// Health check route
app.get('/', (req, res) => {
    res.send('PDF to Image Backend is running!');
});

// The main conversion route
app.post('/api/convert', upload.single('pdfFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No PDF file provided.' });
    }

    try {
        const scale = parseFloat(req.body.scale) || 1.5;
        const pdfBuffer = req.file.buffer;

        // 1. Load the PDF document from the buffer
        const pdfDocument = await getDocument({ data: pdfBuffer }).promise;
        const numPages = pdfDocument.numPages;
        
        const zip = new JSZip();
        const canvasFactory = new NodeCanvasFactory();

        // 2. Loop through each page
        for (let i = 1; i <= numPages; i++) {
            const page = await pdfDocument.getPage(i);
            const viewport = page.getViewport({ scale });

            const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
            const renderContext = {
                canvasContext: canvasAndContext.context,
                viewport,
                canvasFactory,
            };

            // 3. Render page to canvas
            await page.render(renderContext).promise;

            // 4. Get PNG buffer and add to zip
            const imageBuffer = canvasAndContext.canvas.toBuffer('image/png');
            zip.file(`page_${String(i).padStart(3, '0')}.png`, imageBuffer);

            // 5. Clean up
            page.cleanup();
            canvasFactory.destroy(canvasAndContext);
        }

        // 6. Generate the final zip file
        const zipBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
        });

        // 7. Send the zip file back
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="converted_images.zip"`);
        res.status(200).send(zipBuffer);

    } catch (error) {
        console.error('Error in /api/convert:', error);
        res.status(500).json({ 
            error: 'Failed to convert PDF.', 
            message: error.message 
        });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
