import { SignalEventManager } from "./signalEventManager"
import { Local, Message, PeerInfo } from "./@types"
import EventEmitter = require('eventemitter3')
// @ts-ignore
import adapter from 'webrtc-adapter'
import Peer from "./peer"

const log = (...args: any[]) => console.log('<Main>', ...args)
export interface XPeerInit {
  signalServer: string
  peerConfig?: RTCConfiguration
}
// 处理接收的websocket
interface XPeerEventMap {
  "mute": Peer & { track: MediaStreamTrack }
  "unmute": Peer & { track: MediaStreamTrack }
  /**
   * join 表示有新用户加入房间
   * connected 表示本地成功(主动的)连接到远端
   */
  "join": Peer
  "connect": Peer
  "leave": PeerInfo
  "roomInfo": PeerInfo[]
  "stream:user": Peer
  "stream:display": Peer
  "signal:open": void
  "signal:error": void
  "signal:close": void
  "negotiationneeded:done": Peer
  "streamStop:display": Peer
  "message": {
    "peer": Peer
    "payload": string
  }
  "binary": {
    "peer": Peer
    "payload": ArrayBuffer
  }
}

const DEFAULT_PEER_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
}
// type XPeerEventHandler = <T extends keyof XPeerEventMap>(event: T, cb: XPeerEventMap[T]) => void
export default class XPeer {
  local: Local
  signalServer: string
  ws?: WebSocket
  peerConfig: RTCConfiguration
  eventBus: EventEmitter = new EventEmitter()
  constructor({ signalServer, peerConfig }: XPeerInit) {
    this.local = {
      id: '',
      nick: '',
      Peers: [],
      media: {}
    }
    this.signalServer = signalServer
    this.peerConfig = peerConfig || DEFAULT_PEER_CONFIGURATION

  }
  initWebsocketEvent() {
    this.ws = new WebSocket(this.signalServer)
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.addEventListener('open', () => {
          this.emit('signal:open')
          const signalEventManager = new SignalEventManager(this)
          // 保活，注册对应事件
          signalEventManager.handle()
          resolve(this.ws)
        })
        this.ws.addEventListener('error', () => {
          this.emit('signal:error')
          reject('ws error in initWebsocketEvent')
        })
        this.ws.addEventListener('close', () => {
          this.emit('signal:close')
          reject('ws close in initWebsocketEvent')
        })
      }
    })
    // this.ws.onmessage = (event) => {
    //   const message = JSON.parse(event.data)
    //   signalEventManager.handle(message)
    //   // message.type
    // }
  }
  async join({ roomId, nick }: { roomId: string, nick: string }) {
    // shareUser first, localPeer.media.user
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      await this.initWebsocketEvent()
    }
    const { local: localPeer } = this
    // 如果有昵称，则发送最新的昵称
    if (nick) localPeer.nick = nick


    // 主动加入房间动作
    const message: Message = {
      type: 'join',
      receiverId: null,
      payload: {
        roomId,
        nick: localPeer.nick
      }
    }
    // 发给服务器，服务器返回房间用户列表信息
    this.signalSend(message)
    // TODO：promisify
    /* 
    this.signalSend(message)
    .then(roomInfo => createOffer())
    .then(offer => roomInfo.forEach(peerInfo => sendTo(peerInfo, offer)))
    .then(answer => setLocalDescription(answer))
    */
    return localPeer
  }

  /**
   * 通过开启一个datachannel作为初始连接方式
   * @param peerInfo 需要连接的用户信息
   */
  connectPeer(peerInfo: PeerInfo) {
    const peer = new Peer(
      peerInfo.id,
      peerInfo.nick,
      new RTCPeerConnection(this.peerConfig),
      this
    )
    this.addPeer(peer)
    // 不能connect之后再add，因为connect会先找到已经存在的peer
    // TODO: 或许可以另起一个临时队列，超时就清空，成功就加入。
    peer.connect()
    // 创建dc/推流 -> 触发negotiationneeded -> createOffer & setLocal & send -> receiverAnswer & setLocal -> icecandidate -> pc.track/dc.message
  }
  addPeer(peer: Peer) {
    this.local.Peers.push(peer)
  }
  findPeer(id: string) {
    return this.local.Peers.find(peer => peer.id === id)
  }
  signalSend(message: Message) {
    this.onSignalServerReady(() => {
      this.ws?.send(JSON.stringify(message))
    })
  }
  shareUser(constraints: MediaStreamConstraints = {}) {
    // 分享视频
    const { local } = this
    return navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        // 打上tag，让createOffer读该tag再发送给对方s
        // @ts-ignore BUG
        // 将本地流添加到本地peer中
        local.media.user = stream
        // 得到音视频轨道
        const tracks = stream.getTracks()
        // 将轨道添加到其他所有Peer中
        const trackTags = tracks.map(track => `[user/${track.id}]`).join('')
        // @ts-ignore
        local.trackTags = trackTags
        local.Peers.forEach(peer => {
          tracks.forEach(track => {
            // @ts-ignore
            log(`添加track到peer中`, { peer, track })
            peer.peerConnection.addTrack(track, stream)
          })
        })
        // TODO: emit一个media事件
        return local
      }).catch(err => {
        // @ts-ignore
        throw new Error(`unable to get user media: ${err.message}`)
      })
  }
  shareDisplay(constraints: DisplayMediaStreamConstraints = {}) {
    const { local: localPeer } = this
    return navigator.mediaDevices.getDisplayMedia(constraints)
      .then(stream => {

        // 将本地流添加到本地peer中
        localPeer.media.display = stream
        // 得到音视频轨道
        const tracks = stream.getTracks()
        // 将轨道添加到其他所有Peer中

        const trackTags = tracks.map(track => `[display/${track.id}]`).join('')
        // @ts-ignore
        localPeer.trackTags = trackTags
        localPeer.Peers.forEach(peer => {
          tracks.forEach(track => {
            peer.peerConnection.addTrack(track, stream)
          })
        })
        // 添加停止事件
        localPeer.media.display.addEventListener('inactive', () => {
          this.send('streamStop:display')
          delete this.local.media.display
        })
        // TODO: emit一个media事件
        return localPeer
      }).catch(err => {
        // @ts-ignore
        throw new Error(`unable to get user media: ${err.message}`)
      })
  }
  /**
   * 将本地已有的stream全部推送到远端
   * @param peer Peer实例
   */
  pushLocalStreamTo(peer: Peer) {
    const { user, display } = this.local.media
    const pc = peer.peerConnection


    /**
     * 首次推送，会有多个track，多个tag，id会保持一致
     */
    // @ts-ignore
    let trackTags = ''
    if (user) {
      user.getTracks().forEach(track => {
        trackTags += `[user/${track.id}]`
        pc.addTrack(track, user)
      })

    }
    if (display) {
      display.getTracks().forEach(track => {
        trackTags += `[display/${track.id}]`
        pc.addTrack(track, display)
      })
    }
    // @ts-ignore
    this.local.trackTags = trackTags
  }
  /**
   * 保证在websocket已经连接成功后执行
   * @param cb 需要执行的回调函数
   */
  private onSignalServerReady(cb: () => void) {
    if (!this.ws) {
      throw new Error('signal server not ready')
    }
    // websocket连接成功
    if (this.ws.readyState === WebSocket.OPEN) {
      cb()
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.addEventListener('open', () => {
        cb()
      })
    } else if (this.ws.readyState === WebSocket.CLOSED) {
      this.initWebsocketEvent().then(cb)
      // TODO: 重连
    }
  }
  leave() {
    // 主动leave，也许发送一个leave事件更佳？

    // 关闭MediaStream
    this.local.media.user?.getTracks().forEach(track => track.stop())
    this.local.media.display?.getTracks().forEach(track => track.stop())
    delete this.local.media.user
    delete this.local.media.display
    // 关闭PeerConnection
    this.local.Peers.forEach(peer => {
      peer.peerConnection.close()
      peer.dataChannel?.close()
    })
    this.local.Peers = []
    this.ws?.close()
    delete this.ws
    // memory leak
    this.eventBus.removeAllListeners()
  }
  on<E extends keyof XPeerEventMap, Arg extends XPeerEventMap[E]>(event: E, cb: (arg: Arg, type: boolean) => void) {
    this.eventBus.on(event, cb, this)
  }
  emit<E extends keyof XPeerEventMap, Arg extends XPeerEventMap[E]>(event: E, args?: Arg) {
    this.eventBus.emit(event, args)
  }
  setMute(kind: 'audio' | 'video', enabled: boolean) {
    if (this.local.media.user) {
      this.local.media.user.getTracks().forEach(track => {
        if (track.kind === kind) track.enabled = enabled
      })
      return Promise.resolve()
    } else {
      return Promise.reject(new Error('no user media'))
    }
  }
  /**
   * send a ArrayBuffer as Binary to all Peers(Broadcast)
   * @param {ArrayBuffer} payload
   */
  sendBinary(payload: ArrayBuffer) {
    // 字符串、Blob、ArrayBuffer 或 ArrayBufferView
    this.local.Peers.forEach(peer => peer.sendBinary(payload))
  }
  /**
   * send string to all Peers(Broadcast)
   * @param {string} message 
   */
  send(message: string) {
    this.local.Peers.forEach(peer => peer.send(message))
  }
}
