const WebSocket = require("ws");

let wss;

function initSocket(server) {
  wss = new WebSocket.Server({ server });

  wss.on("connection", (ws) => {
  });
}

function broadcast(data) {
  if (!wss) return;

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

module.exports = {
  initSocket,
  broadcast
};