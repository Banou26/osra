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
