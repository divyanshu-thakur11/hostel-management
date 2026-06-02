const express    = require('express');
const mongoose   = require('mongoose');
const router     = express.Router();
const ctrl       = require('../controllers/receiptController');
const { authMiddleware } = require('../middleware/auth');
const Hostel     = require('../models/Hostel');

router.use(authMiddleware);

// helper — same pattern as every other route
const getHostelId = async (req) => {
  if (req.user.role === 'owner') {
    if (req.hostelId) return req.hostelId;
    const first = await Hostel.findOne({ isActive: true }).sort({ createdAt: 1 });
    return first?._id;
  }
  return req.user.hostelId;
};

router.get('/next-numbers',             ctrl.nextNumbers);
router.get('/room/:roomNumber/summary', ctrl.roomSummary);
router.get('/room/:roomNumber',         ctrl.byRoom);
router.get('/',                         ctrl.list);
router.post('/',                        ctrl.create);
router.delete('/:id',                   ctrl.remove);

// F8: Natural-language query — Anthropic called server-side (no CORS, API key safe)
const ALLOWED_COLLECTIONS = ['receipts', 'members'];
const BLOCKED_STAGES = ['$out','$merge','$indexStats','$currentOp','$planCacheStats','$lookup','$function','$accumulator'];
const https = require('https');

// F8: Gemini free tier — replaces Anthropic
const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash-lite',
];

function callGeminiModel(model, systemPrompt, userMessage, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 600, temperature: 0.1 },
    });
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); }
        catch(e) { return reject(new Error('Invalid JSON from Gemini')); }
        if (parsed.error) return reject(new Error('MODEL_NOT_FOUND:' + (parsed.error.message || '')));
        if (res.statusCode >= 400) return reject(new Error('MODEL_NOT_FOUND:HTTP ' + res.statusCode));
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Gemini request timed out')); });
    req.write(body);
    req.end();
  });
}

async function callGemini(systemPrompt, userMessage) {
  const apiKey = process.env.GEMINI_API_KEY || '';
  for (const model of GEMINI_MODELS) {
    try {
      console.log(`Trying Gemini model: ${model}`);
      const result = await callGeminiModel(model, systemPrompt, userMessage, apiKey);
      console.log(`✓ Gemini model ${model} succeeded`);
      return result;
    } catch(err) {
      if (err.message.startsWith('MODEL_NOT_FOUND:')) {
        console.log(`✗ Model ${model} not available, trying next...`);
        continue; // try next model
      }
      throw err; // real error, stop trying
    }
  }
  throw new Error('No Gemini model available. Check your API key and try again.');
}

router.post('/nl-query', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') return res.status(400).json({ message: 'Query required' });
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ message: 'GEMINI_API_KEY not configured on server. Add it in Render → Environment.' });

    const system = `You are a MongoDB aggregation pipeline generator for a hostel management system.
Collections available:
- receipts: hostelId, memberName, roomNumber, totalAmount, amountPaid, balanceDue, packageName, isPartPayment, receiptDate, modeOfPayment, billNumber
- members: hostelId, name, roomNumber, mobileNo, isActive, rent, advance, admissionDate, roomLeavingDate, policeFormVerified

Rules:
1. Return ONLY a raw JSON object — no markdown, no explanation, no code fences
2. Format: { "collection": "receipts" or "members", "pipeline": [ ...stages ] }
3. Do NOT add $match on hostelId — it is injected automatically
4. Do NOT use $out, $merge, $lookup, $function, $accumulator
5. Keep it simple. Use $group, $sort, $project, $limit, $unwind as needed
6. Always end with { "$limit": 20 }

Examples:
Q: which room has most dues?
A: {"collection":"receipts","pipeline":[{"$match":{"balanceDue":{"$gt":0}}},{"$group":{"_id":"$roomNumber","totalDue":{"$sum":"$balanceDue"},"count":{"$sum":1}}},{"$sort":{"totalDue":-1}},{"$limit":5}]}

Q: show members without police verification
A: {"collection":"members","pipeline":[{"$match":{"policeFormVerified":{"$ne":true},"isActive":{"$ne":false}}},{"$project":{"name":1,"roomNumber":1,"mobileNo":1,"admissionDate":1}},{"$limit":20}]}`;

    const aiResp = await callGemini(system, query);
    // Gemini response: candidates[0].content.parts[0].text
    const raw = aiResp.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) {
      console.error('Gemini full response:', JSON.stringify(aiResp).slice(0, 500));
      return res.status(502).json({ message: 'Empty response from Gemini — check Render logs' });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch(e) {
      return res.status(502).json({ message: 'AI returned invalid JSON. Try rephrasing.' });
    }

    const { collection, pipeline } = parsed;
    if (!ALLOWED_COLLECTIONS.includes(collection))
      return res.status(400).json({ message: 'AI chose invalid collection' });
    if (!Array.isArray(pipeline))
      return res.status(400).json({ message: 'AI returned invalid pipeline' });
    const pipeStr = JSON.stringify(pipeline);
    if (BLOCKED_STAGES.some(s => pipeStr.includes(s)))
      return res.status(400).json({ message: 'Blocked pipeline stage detected' });

    const Model    = collection === 'receipts' ? require('../models/Receipt') : require('../models/Member');
    const hostelId = await getHostelId(req);

    // Safe ObjectId casting — hostelId might already be an ObjectId or a string
    let hostelOid;
    try {
      hostelOid = mongoose.Types.ObjectId.isValid(String(hostelId))
        ? new mongoose.Types.ObjectId(String(hostelId))
        : hostelId;
    } catch(_) { hostelOid = hostelId; }

    const safePipeline = [
      { $match: { hostelId: hostelOid } },
      ...pipeline,
    ];
    const hasLimit = pipeline.some(s => s.$limit);
    if (!hasLimit) safePipeline.push({ $limit: 20 });

    const results = await Model.aggregate(safePipeline);
    res.json({ results, collection, pipelineUsed: safePipeline.length });
  } catch(err) {
    console.error('NL query error:', err.message);
    res.status(500).json({ message: err.message || 'Query failed' });
  }
});

// Legacy /query route kept for compatibility (bypasses AI — direct pipeline)
router.post('/query', async (req, res) => {
  try {
    const { collection, pipeline } = req.body;
    if (!ALLOWED_COLLECTIONS.includes(collection)) return res.status(400).json({ message: 'Invalid collection' });
    if (!Array.isArray(pipeline)) return res.status(400).json({ message: 'Invalid pipeline' });
    const pipeStr = JSON.stringify(pipeline);
    if (BLOCKED_STAGES.some(s => pipeStr.includes(s))) return res.status(400).json({ message: 'Blocked pipeline stage' });
    const Model    = collection === 'receipts' ? require('../models/Receipt') : require('../models/Member');
    const hostelId = await getHostelId(req);
    let hostelOid;
    try {
      hostelOid = mongoose.Types.ObjectId.isValid(String(hostelId))
        ? new mongoose.Types.ObjectId(String(hostelId))
        : hostelId;
    } catch(_) { hostelOid = hostelId; }
    const safePipeline = [
      { $match: { hostelId: hostelOid } },
      ...pipeline,
      { $limit: 100 },
    ];
    const result = await Model.aggregate(safePipeline);
    res.json(result);
  } catch(err) { res.status(400).json({ message: 'Query failed: ' + err.message }); }
});

// F7: AI receipt note generator — server-side Gemini call (keeps API key secure)
router.post('/generate-note', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY)
      return res.status(503).json({ message: 'GEMINI_API_KEY not configured' });
    const { memberName, roomNumber, packageName, totalAmount, modeOfPayment, isPartPayment, balanceDue } = req.body;
    const prompt = `Member: ${memberName}, Room: ${roomNumber}, Type: ${packageName}, Amount: ₹${totalAmount}, Mode: ${modeOfPayment}, Part payment: ${isPartPayment ? 'yes' : 'no'}${isPartPayment && balanceDue > 0 ? `, Due: ₹${balanceDue}` : ''}`;
    const system = 'You are a hostel receipt assistant. Write one short professional receipt note in 1-2 sentences. Return only the note — no quotes, no markdown, no explanation.';
    const aiResp = await callGemini(system, prompt);
    const note   = aiResp.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!note) return res.status(502).json({ message: 'No note generated' });
    res.json({ note });
  } catch(err) {
    res.status(500).json({ message: err.message || 'Failed to generate note' });
  }
});

module.exports = router;