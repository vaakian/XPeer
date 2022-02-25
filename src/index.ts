import { SignalEventManager } from "./signalEventManager"
import { LocalPeer, Message, Peer, PeerInfo } from "./@types"
// import EventEmitter from "eventemitter3"
import EventEmitter = require('eventemitter3')
// @ts-ignore
import adapter from 'webrtc-adapter'

export const EE = new EventEmitter()

// const log = (...args: any[]) => args
const log = console.log
export interface XPeerInit {
  signalServer: string
  peerConfig: RTCConfiguration
}
// 处理接收的websocket
interface XPeerEventMap {
  "mute": Peer & { track: MediaStreamTrack },
  "unmute": Peer & { track: MediaStreamTrack },
  "join": Peer,
  "leave": PeerInfo,
  "roomInfo": PeerInfo[],
  "stream:user": Peer,
  "stream:display": Peer
}
// type XPeerEventHandler = <T extends keyof XPeerEventMap>(event: T, cb: XPeerEventMap[T]) => void
export default class XPeer {
  localPeer: LocalPeer
  signalServer: string
  ws?: WebSocket
  peerConfig: RTCConfiguration
  constructor({ signalServer, peerConfig }: XPeerInit) {
    this.localPeer = {
      id: '',
      nick: '',
      Peers: [],
      media: {}
    }
    this.signalServer = signalServer
    this.peerConfig = peerConfig

  }
  initWebsocketEvent() {
    this.ws = new WebSocket(this.signalServer)
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.addEventListener('open', () => {
          EE.emit('signal:open')
          const signalEventManager = new SignalEventManager(this)
          signalEventManager.handle()
          resolve(this.ws)
        })
        this.ws.addEventListener('error', () => {
          EE.emit('signal:error')
          reject('ws error in initWebsocketEvent')
        })
        this.ws.addEventListener('close', () => {
          EE.emit('signal:close')
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
    const { localPeer } = this
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
  initTrackHandler(peer: Peer) {
    return (event: RTCTrackEvent) => {
      log('PC:[track] 主动者收', event)
      // 得到远程音视频轨道
      const track = event.track
      // 将轨道添加到其他所有Peer中
      // @ts-ignore
      const sdp: string = event.target.remoteDescription.sdp.toString()
      const addUserTrack = () => {
        if (!peer.media.user) {
          peer.media.user = new MediaStream()
          // 新加入（被动）
          EE.emit('stream:user', peer)
        }
        peer.media.user.addTrack(track)
      }
      const addDisplayTrack = () => {
        if (!peer.media.display) {
          peer.media.display = new MediaStream()
          // 新加入（被动）
          EE.emit('stream:display', peer)
        }
        peer.media.display.addTrack(track)
      }
      if (sdp.indexOf(`[user/${track.id}]`) !== -1) {
        addUserTrack()
        // TODO: ~~注册track的事件，用于mute和unmute~~
      } else if (sdp.indexOf(`[display/${track.id}]`) !== -1) {
        addDisplayTrack()
      } else {
        // 都匹配不到那就是单独推track，只匹配字符
        if (sdp.indexOf('[user/') !== -1) addUserTrack()
        else if (sdp.indexOf('[display/') !== -1) addDisplayTrack()
      }
    }
  }
  initIceCandidateHandler(peer: Peer) {
    return (event: RTCPeerConnectionIceEvent) => {
      log('PC:[icecandidate]', event)
      if (event.candidate) {
        // event.candidate may be null
        this.signalSend({
          type: 'icecandidate',
          receiverId: peer.id,
          payload: event.candidate
        })
      }
    }
  }
  /**
   * 通过开启一个datachannel作为初始连接方式
   * @param peerInfo 需要连接的用户信息
   */
  connectPeer(peerInfo: PeerInfo) {
    log('connectPeer', peerInfo)
    const pc = new RTCPeerConnection(this.peerConfig)

    // 创建datachannel之后，即会触发negotiationneeded事件，以此为实际的connect动作。
    const dc = pc.createDataChannel('dc')
    const peer: Peer = {
      id: peerInfo.id,
      nick: peerInfo.nick,
      peerConnection: pc,
      media: {},
      dataChannel: null
    }

    // datechannel:open 要单独拎出来：主动者创建datachannel，接受者接受该datachannel
    dc.addEventListener('open', e => {
      log('dc open', e)
      peer.dataChannel = dc
      this.emit('join', peer, false)
      this.initDataChannelHandler(peer)
    })
    // 注册pc事件
    this.initPeerEvents(peer)
    // 全部初始化完毕，放入peer数组中
    this.addPeer(peer)
    // 创建dc/推流 -> 触发negotiationneeded -> creaeOffer & setLocal & send -> receiverAnswer & setLocal -> icecandidate -> pc.track/dc.message
  }
  initPeerEvents(peer: Peer) {
    const pc = peer.peerConnection
    // 注册事件
    pc.addEventListener('icecandidate', this.initIceCandidateHandler(peer))
    pc.addEventListener('track', this.initTrackHandler(peer))
    pc.addEventListener('negotiationneeded', this.initNegotiationHandler(peer))
  }
  /**
   * 返回一个事件处理函数
   * @param peer peer that needs initialization
   * @returns handlerFunction
   */
  initNegotiationHandler(peer: Peer) {
    // const peers = this.localPeer.Peers
    const pc = peer.peerConnection
    return () => {
      log('PC:[negotiationneeded]', pc)
      pc.createOffer()
        .then(offer => {
          // @ts-ignore
          offer.sdp = addCustomLabelToSdp(offer.sdp, this.localPeer.trackTags)
          return pc.setLocalDescription(offer)
        })
        .then(() => {
          // 此时sdp已经修改完毕
          EE.emit('negotiationneeded:done', peer)
          if (pc.localDescription) {
            // 发送offer
            this.signalSend({
              type: 'offer',
              // peer的connection需要重新协商，那么就发给这个peer
              receiverId: peer.id,
              payload: pc.localDescription
            })
          }
          // 重大bug
          // peers.forEach(peer => {
          //   this.signalSend({
          //     type: 'offer',
          //     receiverId: peer.id,
          //     payload: pc.localDescription as RTCSessionDescriptionInit
          //   })
          // })
        })
    }
  }
  // 与其它init不同
  initDataChannelHandler(peer: Peer) {
    if (peer.dataChannel) {
      peer.dataChannel.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const { payload } = JSON.parse(event.data)
          console.log('datachannel:收到消息', event)
          if (payload === 'streamStop:display') {
            // 清掉他的display
            delete peer.media.display
            EE.emit('streamStop:display', peer)
          } else {
            EE.emit('message', peer, payload)
          }
        } else {
          console.log('datachannel:收到二进制消息', event)
          EE.emit('binary', peer, event.data)
        }
      }
      peer.dataChannel.onclose = (event) => {
        console.log('datachannel:断开连接', event)
      }
    }

  }
  addPeer(peer: Peer) {
    this.localPeer.Peers.push(peer)
  }
  findPeer(id: string) {
    return this.localPeer.Peers.find(peer => peer.id === id)
  }
  signalSend(message: Message) {
    this.onSignalServerReady(() => {
      this.ws?.send(JSON.stringify(message))
    })
  }
  shareUser(constrants: MediaStreamConstraints = {}) {
    // 分享视频
    const { localPeer } = this
    return navigator.mediaDevices.getUserMedia(constrants)
      .then(stream => {
        // 打上tag，让createOffer读该tag再发送给对方s
        // @ts-ignore BUG
        // 将本地流添加到本地peer中
        localPeer.media.user = stream
        // 得到音视频轨道
        const tracks = stream.getTracks()
        // 将轨道添加到其他所有Peer中
        const trackTags = tracks.map(track => `[user/${track.id}]`).join('')
        // @ts-ignore
        localPeer.trackTags = trackTags
        localPeer.Peers.forEach(peer => {
          tracks.forEach(track => {
            // @ts-ignore
            log(`添加track到peer中`, { peer, track })
            peer.peerConnection.addTrack(track, stream)
          })
        })
        // TODO: emit一个media事件
        return localPeer
      }).catch(err => {
        // @ts-ignore
        throw new Error(`unable to get user media: ${err.message}`)
      })
  }
  shareDisplay(constrants: DisplayMediaStreamConstraints = {}) {
    const { localPeer } = this
    return navigator.mediaDevices.getDisplayMedia(constrants)
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
        localPeer.media.display.addEventListener('inactive', this.onStopDisplay.bind(this))
        // TODO: emit一个media事件
        return localPeer
      }).catch(err => {
        // @ts-ignore
        throw new Error(`unable to get user media: ${err.message}`)
      })
  }
  onStopDisplay() {
    this.send('streamStop:display')
    delete this.localPeer.media.display
    // // const { display } = this.localPeer.media
    // if (display) {
    //   this.send(JSON.stringify({
    //     type: 'streamStop:display',
    //     payload: {
    //       id: this.localPeer.id,
    //       nick: this.localPeer.nick
    //     }
    //   }))
    //   // display.getTracks().forEach(track => {
    //   //   track.enabled = false
    //   //   this.send(JSON.stringify({
    //   //     type: 'stream:stop',
    //   //     payload: {
    //   //       id: this.localPeer.id,
    //   //       nick: this.localPeer.nick
    //   //     }
    //   //   }))
    //   // })
    //   delete this.localPeer.media.display
    // } else {

    // }
  }
  onSignalServerReady(cb: () => void) {
    if (!this.ws) {
      throw new Error('signal server not ready')
    }
    // weboscket连接成功
    if (this.ws.readyState === WebSocket.OPEN) {
      cb()
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.addEventListener('open', () => {
        cb()
      })
    } else if (this.ws.readyState === WebSocket.CLOSED) {
      this.initWebsocketEvent().then(cb)
      // TODO: 重连
      // this.ws.addEventListener('open', () => {
      //   cb()
      // })
    }
  }
  leave() {
    // 主动leave，也许发送一个leave事件更佳？

    // 关闭MediaStream
    this.localPeer.media.user?.getTracks().forEach(track => track.stop())
    this.localPeer.media.display?.getTracks().forEach(track => track.stop())
    delete this.localPeer.media.user
    delete this.localPeer.media.display
    // 关闭PeerConnection
    this.localPeer.Peers.forEach(peer => {
      peer.peerConnection.close()
      peer.dataChannel?.close()
    })
    this.localPeer.Peers = []
    this.ws?.close()
    delete this.ws
    // memory leak
    EE.removeAllListeners()
  }
  on<E extends keyof XPeerEventMap, Arg extends XPeerEventMap[E]>(event: E, cb: (arg: Arg, type: boolean) => void) {
    EE.on(event, cb, this)
  }
  emit<E extends keyof XPeerEventMap, Arg extends XPeerEventMap[E]>(event: E, args: Arg, type: boolean = true) {
    EE.emit(event, args, type)
  }
  setMute(kind: 'audio' | 'video', enabled: boolean) {
    if (this.localPeer.media.user) {
      this.localPeer.media.user.getTracks().forEach(track => {
        if (track.kind === kind) track.enabled = enabled
      })
      return Promise.resolve()
    } else {
      return Promise.reject(new Error('no user media'))
    }
  }
  sendBinary(payload: Blob) {
    // 字符串、Blob、ArrayBuffer 或 ArrayBufferView
    this.localPeer.Peers.forEach(peer => {
      peer.dataChannel?.send(payload)
    })
  }
  send(message: string) {
    const userInfo: PeerInfo = {
      id: this.localPeer.id,
      nick: this.localPeer.nick
    }
    this.localPeer.Peers.forEach(({ dataChannel }) => {
      dataChannel?.send(JSON.stringify({
        userInfo,
        payload: message
      }))
    })
  }

}
// type XPeer = typeof XPeer

function addCustomLabelToSdp(sdp: string = '', str: string = '') {
  console.log('addCustomLabelToSdp', { sdp, str })
  let lines = sdp.split("\n")

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    line = line.replace(/(a=extmap:[0-9]+) [^ \n]+/gi, `$1 ${str}`)
    lines[i] = line
  }

  return lines.join("\n")
}
// @ts-ignore
window['XPeer'] = XPeer