import Peer from "../peer"

export interface Media {
  display?: MediaStream
  user?: MediaStream
}
// export interface IPeer {
//   id: string
//   nick: string
//   // LocalPeer与该Peer连接的RTCPeerConnection
//   peerConnection: RTCPeerConnection
//   // track有两种，屏幕共享和用户音视频（远程向本地共享的）
//   media: Media
//   // dataChannel用于发送文本或其它二进制数据（文件）
//   dataChannel: RTCDataChannel | null
// }


// 一个LocalPeer对应对个Peers
export interface Local {
  id: string
  nick: string
  Peers: Peer[]
  media: Media
}


export interface PeerInfo {
  id: string
  nick: string
}
export interface PayloadMap {
  // 发送给服务器的消息
  join: { roomId: string, nick: string }
  offer: RTCSessionDescriptionInit
  answer: RTCSessionDescriptionInit
  icecandidate: RTCIceCandidateInit
  //leave 只可能是客户端接收，PeerInfo由服务端添加
  leave: PeerInfo
  roomInfo: {
    userInfo: PeerInfo,
    users: PeerInfo[]
  }
}
// 客户端发送，服务端接受的数据格式
export type Message = {
  [k in keyof PayloadMap]: {
    type: k
    // nick?: string
    receiverId: string | null
    // playload的类型取决于type的值
    payload: PayloadMap[k]
    // 当接受时才有userInfo
    userInfo?: PeerInfo
  }
}[keyof PayloadMap]

