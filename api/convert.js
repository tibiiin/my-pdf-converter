const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('canvas');
const JSZip = require('jszip');
const formidable = require('formidable');
const fs = require('fs');

// --- Polyfill for pdf.js in Node.js environment ---
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

// Disable Vercel's default body parser
export const config = {
    api: {
        bodyParser: false,
    },
};

// The main serverless function
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const form = formidable({});
        
        // 1. Parse the incoming form data
        const [fields, files] = await form.parse(req);

        // formidable v3 wraps fields and files in arrays, get the first value
        const pdfFile = files.pdfFile ? files.pdfFile[0] : null;
        const scale = fields.scale ? parseFloat(fields.scale[0]) : 1.5;
        
        if (!pdfFile) {
            return res.status(400).json({ error: 'No PDF file provided.' });
        }

        // 2. Read the PDF file from its temporary path
        const pdfBuffer = fs.readFileSync(pdfFile.filepath);
        fs.unlinkSync(pdfFile.filepath); // Clean up the temporary file

        // 3. Load the PDF document
        const pdfDocument = await getDocument({ data: pdfBuffer }).promise;
        const numPages = pdfDocument.numPages;
        
        const zip = new JSZip();
        
        // *** THIS IS THE REAL FIX: Removed the extra "new" ***
        const canvasFactory = new NodeCanvasFactory();

        // 4. Loop through each page and convert
        for (let i = 1; i <= numPages; i++) {
            const page = await pdfDocument.getPage(i);
            const viewport = page.getViewport({ scale });

            const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
            const renderContext = {
                canvasContext: canvasAndContext.context,
                viewport,
                canvasFactory,
            };

            await page.render(renderContext).promise;
            const imageBuffer = canvasAndContext.canvas.toBuffer('image/png');
            zip.file(`page_${String(i).padStart(3, '0')}.png`, imageBuffer);

            page.cleanup();
            canvasFactory.destroy(canvasAndContext);
        }

        // 5. Generate the final zip file buffer
        const zipBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
        });

        // 6. Send the zip file back
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
}

