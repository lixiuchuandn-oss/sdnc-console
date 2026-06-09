const fs = require('fs');
const { completeChunks, listChunks, putChunk } = require('./images-api.cjs');

async function uploadAllChunksFromFile(token, cloudId, task, filePath) {
  const stat = fs.statSync(filePath);
  const fileSize = Math.max(0, Math.floor(Number(task.fileSize) || stat.size));
  const chunkSize = Math.max(1, Math.floor(Number(task.chunkSize) || fileSize));
  const totalChunks = Math.max(1, Math.floor(Number(task.totalChunks) || 1));
  const taskId = String(task.id || '');
  if (!taskId) throw new Error('task missing id');

  const fd = await fs.promises.open(filePath, 'r');
  const uploaded = [];
  try {
    for (let i = 0; i < totalChunks; i++) {
      const offset = i * chunkSize;
      const end = Math.min(offset + chunkSize, fileSize);
      const len = end - offset;
      const chunk = Buffer.alloc(len);
      const { bytesRead } = await fd.read(chunk, 0, len, offset);
      const body = bytesRead === len ? chunk : chunk.subarray(0, bytesRead);
      const r = await putChunk(token, cloudId, taskId, i, body);
      if (r.status !== 200) {
        throw new Error(`put chunk ${i} HTTP ${r.status}: ${r.data?.message || r.data?.error || ''}`);
      }
      uploaded.push(i);
    }
  } finally {
    await fd.close();
  }

  const chunksState = await listChunks(token, cloudId, taskId);
  const received = chunksState.data?.receivedChunks || [];
  const completed = await completeChunks(token, cloudId, taskId);
  return { uploaded, received, completed };
}

module.exports = { uploadAllChunksFromFile };
