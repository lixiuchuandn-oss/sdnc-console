
const http = require('http');
const fs = require('fs');

const taskId = '9144e6af-2bb1-4505-b9c2-f32e022a3b10';
const options = {
  hostname: 'localhost',
  port: 5000,
  path: `/api/leased-lines/security-report/tasks/${taskId}/download?type=WXB_ZIP`,
  method: 'GET',
  headers: {
     // Simulate permissions? Wait, I need a token.
     // Or I can modify backend to skip auth for localhost.
  }
};

// Actually, I'll modify the backend to log errors extensively first.
// This script is just a placeholder idea.
console.log("Use backend logs instead.");
