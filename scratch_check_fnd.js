const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const lines = html.split('\n');
lines.forEach((l, i) => {
  if (l.includes('view-foundation') || l.includes('openFoundationInterface') || l.includes('renderFoundationDashboard') || l.includes('openEditFoundationModal')) {
    console.log((i + 1) + ': ' + l.trim());
  }
});
