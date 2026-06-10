// Broadcast relay for the WebSocket transport tests: every text frame is
// forwarded to every *other* connected client (osra drops its own looped-back
// messages by uuid anyway, but not echoing keeps the traffic clean).
import { WebSocketServer } from 'ws'

const server = new WebSocketServer({ port: 3001 })

server.on('connection', (socket) => {
  socket.on('message', (data) => {
    for (const client of server.clients) {
      if (client !== socket && client.readyState === 1) client.send(data.toString())
    }
  })
})

console.log('ws relay listening on :3001')
