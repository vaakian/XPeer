import { EE, XPeer } from "."
import { Message, Peer, PeerInfo } from "./types"
// const log = (...args: any[]) => args
const log = console.log
export class SignalEventManager {
  constructor(private xPeer: XPeer) {
    this.xPeer = xPeer
  }
  roomInfo(message: Message) {
    // 收到房间信息列表（在主动join后）
    // 且本地有流（用户授权）
    if (message.type === 'roomInfo') {
      const { users, userInfo } = message.payload
      this.xPeer.localPeer.nick = userInfo.nick
      this.xPeer.localPeer.id = userInfo.id
      users.forEach(peerInfo => {
        this.xPeer.connectPeer(peerInfo)
      })
      this.xPeer.emit('roomInfo', users)
    }
  }
  async offer(message: Message) {
    // join event
    // 收到offer: new pc -> setRemoteDescription -> createAnswer -> setLocalDescription -> send answer
    if (message.userInfo && message.type === 'offer') {
      const peerInfo = message.userInfo
      let pc: RTCPeerConnection

      const existingPeer = this.xPeer.findPeer(peerInfo.id)
      if (existingPeer) {
        // 已经存在Peer
        // 说明是renegotiation
        pc = existingPeer.peerConnection
      } else {
        // 否则是新建连接Peer
        // 创建新的RTCPeerConnection
        pc = new RTCPeerConnection(this.xPeer.peerConfig)
        // 生成用户信息
        const peer: Peer = {
          id: peerInfo.id,
          nick: peerInfo.nick,
          peerConnection: pc,
          media: {},
          dataChannel: null
        }

        pc.addEventListener('datachannel', (event) => {
          console.log('data channel open')
          peer.dataChannel = event.channel
          // event.channel.binaryType = 'arraybuffer'
          this.xPeer.emit('join', peer, true)
          this.xPeer.initDataChannelHandler(peer)
        })

        // 注册pc事件
        this.xPeer.initPeerEvents(peer)
        this.xPeer.localPeer.Peers.push(peer)

        // 并把本地流推送给新来的

        const { user, display } = this.xPeer.localPeer.media
        // 这里有sdp的trackType问题：大BUG
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
        this.xPeer.localPeer.trackTags = trackTags
      }
      this.replayAnswer(pc, message)
    }

  }
  replayAnswer(pc: RTCPeerConnection, message: Message) {
    // @ts-ignore
    pc.setRemoteDescription(new RTCSessionDescription(message.payload))
      .then(() => pc.createAnswer())
      .then(answer => pc.setLocalDescription(answer))
      .then(() => {
        const messageToBeSent: Message = {
          type: 'answer',
          // @ts-ignore
          receiverId: message.userInfo.id,
          payload: pc?.localDescription as RTCSessionDescriptionInit
        }
        this.xPeer.signalSend(messageToBeSent)
      }).catch(err => {
        throw new Error(`replayAnswer error: ${err}`)
      })
  }
  answer(message: Message) {
    // 接收到answer
    if (message.type === 'answer' && message.userInfo) {
      const senderInfo: PeerInfo = message.userInfo
      // 找到相应的peer信息
      const peer = this.xPeer.findPeer(senderInfo.id)
      if (peer) {
        peer.peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload))
      }
      // 其它事件已经在connectPeer中注册：icecandidate, track
    }

  }
  icecandidate(message: Message) {
    // 收到icecandidate
    if (message.type === 'icecandidate' && message.userInfo) {
      const senderInfo: PeerInfo = message.userInfo
      // 找到相应的peer信息
      const peer = this.xPeer.findPeer(senderInfo.id)
      peer && peer.peerConnection.addIceCandidate(new RTCIceCandidate(message.payload))
    }
  }
  leave(message: Message) {
    if (message.type === 'leave') {
      const peer = this.xPeer.findPeer(message.payload.id)
      if (peer) {
        // 关闭pc
        peer.peerConnection.close()
        // 移除该peer
        this.xPeer.localPeer.Peers = this.xPeer.localPeer.Peers.filter(p => p !== peer)
      }
      // TODO: emit leave event
      this.xPeer.emit('leave', message.payload)
    }
  }
  join(message: Message) {
    // impossible event
  }
  // ping() {
  //   // @ts-ignore
  //   this.xPeer.signalSend({ type: 'pong' })
  // }
  handle() {
    const instance = this
    // attach eventListener to the websocket connection
    // 注意重连时的动作
    // @ts-ignore
    window.xPeer = this.xPeer
    if (this.xPeer.ws) {
      this.xPeer.ws.addEventListener('message', function ({ data }) {
        const message: Message = JSON.parse(data)
        log(`received [${message.type}]`, message)
        instance[message.type](message)
      })


      const keepAliveInterval = setInterval(this.keepAlive, 59 * 1000)
      this.xPeer.ws.addEventListener('close', () => clearInterval(keepAliveInterval))

    } else {
      throw new Error('ws is not defined when handling signal event')
    }
  }
  // 保活机制
  keepAlive() {
    // @ts-ignore
    this.xPeer.signalSend({ type: 'ping' })
  }

}