import XPeer from "."
import { Message, PeerInfo } from "./@types"
import Peer from "./peer"
// const log = (...args: any[]) => args
const log = (...args: any[]) => console.log('<Signal>', ...args)
export class SignalEventManager {
  constructor(private xPeer: XPeer) {
    this.xPeer = xPeer
  }
  /**
   * 在加入房间时，会立即接收到roomInfo，包含房间用户信息，应该立即主动发起连接。
   * @param message 从服务器收到的消息，包含房间已有的用户信息
   */
  roomInfo(message: Message) {
    // 收到房间信息列表（在主动join后）
    // 且本地有流（用户授权）
    if (message.type === 'roomInfo') {
      const { users, userInfo } = message.payload
      this.xPeer.local.nick = userInfo.nick
      this.xPeer.local.id = userInfo.id
      users.forEach(peerInfo => {
        this.xPeer.connectPeer(peerInfo)
      })
      this.xPeer.emit('roomInfo', users)
    }
  }
  /**
   * 处理从websocket连接收到的offer消息，如果存在peer，则仅仅是回复answer。
   * 否则，创建新的RTCPeerConnection，注册相应的事件处理函数，再回复answer。
   * @param message 从服务器收到的消息
   * @returns {void}
   */
  async offer(message: Message) {

    // 收到offer: new pc -> setRemoteDescription -> createAnswer -> setLocalDescription -> send answer
    if (message.userInfo && message.type === 'offer') {

      const { id, nick } = message.userInfo

      // 找到相应的peer信息(如果存在)
      let peer = this.xPeer.findPeer(id)
      if (!peer) {

        // 否则是新建连接Peer
        peer = new Peer(
          id,
          nick,
          new RTCPeerConnection(this.xPeer.peerConfig),
          this.xPeer
        )
        // 添加动作，是否要移到datachannel时间中？
        this.xPeer.addPeer(peer)

        // 并把本地流推送给对方
        this.xPeer.pushLocalStreamTo(peer)

      }
      // 回复answer
      peer.receiveOffer(message)
    }

  }


  /**
   * 收到answer，那么我一定是主动发起方，本地描述已经设置好，对方已经接受了己方offer。
   * 下一步仅仅需要setRemoteDescription，等待icecandidate即可，连接稍后即建立成功。
   * @param message message from websocket contains answer that was sent by remote peer
   * @returns {void}
   */
  answer(message: Message) {
    // 接收到answer
    if (message.type === 'answer' && message.userInfo) {
      const senderInfo: PeerInfo = message.userInfo
      // 找到相应的peer信息
      const peer = this.xPeer.findPeer(senderInfo.id)
      peer?.receiveAnswer(message.payload)
    }
  }
  icecandidate(message: Message) {
    // 收到icecandidate
    if (message.type === 'icecandidate' && message.userInfo) {
      const senderInfo: PeerInfo = message.userInfo
      // 找到相应的peer信息
      const peer = this.xPeer.findPeer(senderInfo.id)
      peer?.receiveIceCandidate(message.payload)
    }
  }
  leave(message: Message) {
    if (message.type === 'leave') {
      const peer = this.xPeer.findPeer(message.payload.id)
      if (peer) {
        // 关闭pc
        peer.peerConnection.close()
        // 移除该peer
        this.xPeer.local.Peers = this.xPeer.local.Peers.filter(p => p !== peer)
      }
      // TODO: emit leave event
      this.xPeer.emit('leave', message.payload)
    }
  }
  // @ts-ignore
  join(message: Message) {
    // impossible event
  }
  handle() {
    const instance = this
    // attach eventListener to the websocket connection
    // 注意重连时的动作
    // @ts-ignore
    // window.xPeer = this.xPeer
    if (this.xPeer.ws) {
      this.xPeer.ws.addEventListener('message', function ({ data }) {
        const message: Message = JSON.parse(data)
        log(`received [${message.type}]`, message)
        instance[message.type](message)
      })


      const keepAliveInterval = setInterval(() => {
        this.keepAlive()
      }, 59 * 1000)
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