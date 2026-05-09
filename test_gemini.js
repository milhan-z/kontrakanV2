const fetch = require('node-fetch');

const dummyImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function test() {
    const key = 'AIzaSyD0SF7fb3xQPTkouAM91PmyLu2tKYG_MoU';
    const uri = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`;
    
    const body = {
        contents: [{
            parts: [
                { text: "Apa isi gambar ini?" },
                {
                    inline_data: {
                        mime_type: "image/png",
                        data: dummyImageBase64
                    }
                }
            ]
        }]
    };

    try {
        const res = await fetch(uri, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        console.log("Status:", res.status);
        console.dir(data, { depth: null });
    } catch (err) {
        console.error("Network Error:", err);
    }
}

test();
