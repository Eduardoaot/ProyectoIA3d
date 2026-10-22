// Vite aislado para comprobar integración real con el servidor de pruebas en 8001.
import { createServer } from 'vite'
const server = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8001' } } })
await server.listen()
console.log('Data smoke preview: http://127.0.0.1:5187')
