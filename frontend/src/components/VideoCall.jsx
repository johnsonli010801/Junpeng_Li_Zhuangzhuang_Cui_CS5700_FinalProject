import { useEffect, useRef, useState, useCallback } from 'react';

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// 状态机：idle -> dialing/ringing -> connecting -> connected -> ended
const CALL_STATES = {
  IDLE: 'idle',
  DIALING: 'dialing',       // 主叫：等待对方接听
  RINGING: 'ringing',       // 被叫：收到来电
  CONNECTING: 'connecting', // 双方：WebRTC 握手中
  CONNECTED: 'connected',   // 双方：通话中
  ENDED: 'ended',          // 通话结束
};

export function VideoCall({ mode, conversationId, socket, userId, onClose, caller }) {
  const [callState, setCallState] = useState(CALL_STATES.IDLE);
  const [visible, setVisible] = useState(false);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);

  // 清理资源
  const cleanup = useCallback(() => {
    console.log('[VideoCall] 清理资源');
    
    // 关闭 peer connection
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    
    // 停止本地流
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    // 清空视频元素
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    
    pendingCandidatesRef.current = [];
  }, []);

  // 获取本地媒体流
  const getLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      console.log('[VideoCall] 获取本地流成功');
      return stream;
    } catch (error) {
      console.error('[VideoCall] 获取媒体失败:', error);
      alert('无法访问摄像头/麦克风，请检查权限');
      throw error;
    }
  }, []);

  // 创建 PeerConnection
  const createPeerConnection = useCallback(async () => {
    if (peerRef.current) {
      console.log('[VideoCall] PeerConnection 已存在');
      return peerRef.current;
    }

    console.log('[VideoCall] 创建 PeerConnection');
    const pc = new RTCPeerConnection(rtcConfig);
    peerRef.current = pc;

    // ICE candidate 事件
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        console.log('[VideoCall] 发送 ICE candidate');
        socket.emit('webrtc:signal', {
          conversationId,
          payload: { type: 'candidate', candidate: event.candidate },
        });
      }
    };

    // 接收远端流
    pc.ontrack = (event) => {
      console.log('[VideoCall] 收到远端流');
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        setCallState(CALL_STATES.CONNECTED);
      }
    };

    // 连接状态变化
    pc.onconnectionstatechange = () => {
      console.log('[VideoCall] 连接状态:', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.error('[VideoCall] 连接失败');
        handleEnd();
      }
    };

    // 添加本地流
    const stream = await getLocalStream();
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    return pc;
  }, [conversationId, socket]);

  // 主叫：发起呼叫
  const startCall = useCallback(async () => {
    if (!socket || !conversationId) return;
    
    console.log('[VideoCall] 主叫：发起呼叫');
    setCallState(CALL_STATES.DIALING);
    socket.emit('call:invite', { conversationId });
  }, [socket, conversationId]);

  // 被叫：接听
  const acceptCall = useCallback(async () => {
    if (!socket || !conversationId) return;
    
    console.log('[VideoCall] 被叫：接听电话');
    setCallState(CALL_STATES.CONNECTING);
    socket.emit('call:accept', { conversationId });
  }, [socket, conversationId]);

  // 拒绝/挂断
  const handleEnd = useCallback(() => {
    console.log('[VideoCall] 挂断通话');
    if (socket && conversationId && callState !== CALL_STATES.IDLE) {
      socket.emit('call:end', { conversationId });
    }
    cleanup();
    setCallState(CALL_STATES.ENDED);
    setVisible(false);
    onClose();
  }, [socket, conversationId, callState, cleanup, onClose]);

  // 处理 WebRTC 信令
  useEffect(() => {
    if (!socket) return;

    const handleSignal = async ({ conversationId: roomId, payload }) => {
      if (roomId !== conversationId) return;
      
      console.log('[VideoCall] 收到信令:', payload.type);

      try {
        if (payload.type === 'offer') {
          // 被叫方收到 offer
          const pc = await createPeerConnection();
          await pc.setRemoteDescription(new RTCSessionDescription({
            type: 'offer',
            sdp: payload.sdp,
          }));
          
          // 处理待处理的 candidates
          for (const candidate of pendingCandidatesRef.current) {
            await pc.addIceCandidate(candidate);
          }
          pendingCandidatesRef.current = [];
          
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          socket.emit('webrtc:signal', {
            conversationId,
            payload: { type: 'answer', sdp: answer.sdp },
          });
          console.log('[VideoCall] 已发送 answer');
          
        } else if (payload.type === 'answer') {
          // 主叫方收到 answer
          if (!peerRef.current) {
            console.error('[VideoCall] PeerConnection 不存在');
            return;
          }
          await peerRef.current.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: payload.sdp,
          }));
          console.log('[VideoCall] 已设置 answer');
          
        } else if (payload.type === 'candidate') {
          // 收到 ICE candidate
          if (peerRef.current && peerRef.current.remoteDescription) {
            await peerRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
            console.log('[VideoCall] 已添加 candidate');
          } else {
            // 暂存，等 setRemoteDescription 后再添加
            pendingCandidatesRef.current.push(new RTCIceCandidate(payload.candidate));
            console.log('[VideoCall] 暂存 candidate');
          }
        }
      } catch (error) {
        console.error('[VideoCall] 信令处理失败:', error);
      }
    };

    socket.on('webrtc:signal', handleSignal);
    return () => socket.off('webrtc:signal', handleSignal);
  }, [socket, conversationId, createPeerConnection]);

  // 处理呼叫事件
  useEffect(() => {
    if (!socket) return;

    const handleRing = ({ conversationId: roomId }) => {
      if (roomId !== conversationId || mode !== 'incoming') return;
      console.log('[VideoCall] 收到来电');
      setVisible(true);
      setCallState(CALL_STATES.RINGING);
    };

    const handleAccept = async ({ conversationId: roomId }) => {
      if (roomId !== conversationId || mode !== 'outgoing') return;
      console.log('[VideoCall] 对方接听，发送 offer');
      
      setCallState(CALL_STATES.CONNECTING);
      const pc = await createPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socket.emit('webrtc:signal', {
        conversationId,
        payload: { type: 'offer', sdp: offer.sdp },
      });
    };

    const handleDecline = ({ conversationId: roomId }) => {
      if (roomId !== conversationId) return;
      console.log('[VideoCall] 对方拒绝');
      handleEnd();
    };

    const handleCallEnd = ({ conversationId: roomId }) => {
      if (roomId !== conversationId) return;
      console.log('[VideoCall] 对方挂断');
      handleEnd();
    };

    socket.on('call:ring', handleRing);
    socket.on('call:accept', handleAccept);
    socket.on('call:decline', handleDecline);
    socket.on('call:end', handleCallEnd);

    return () => {
      socket.off('call:ring', handleRing);
      socket.off('call:accept', handleAccept);
      socket.off('call:decline', handleDecline);
      socket.off('call:end', handleCallEnd);
    };
  }, [socket, conversationId, mode, createPeerConnection, handleEnd]);

  // 初始化
  useEffect(() => {
    if (mode === 'outgoing') {
      setVisible(true);
      startCall();
    } else if (mode === 'incoming') {
      setVisible(true);
      setCallState(CALL_STATES.RINGING);
    } else {
      setVisible(false);
    }

    return () => {
      cleanup();
    };
  }, [mode, startCall, cleanup]);

  if (!visible) return null;

  const showAnimation = callState === CALL_STATES.DIALING || callState === CALL_STATES.RINGING;
  const callerName = caller?.name || '对方';
  const callerInitial = callerName.charAt(0).toUpperCase();

  return (
    <div className="video-modal">
      <div className="video-modal-content">
        <header>
          <div>
            <strong>视频通话</strong>
            <small>
              {callState === CALL_STATES.RINGING && '来电中...'}
              {callState === CALL_STATES.DIALING && '呼叫中...'}
              {callState === CALL_STATES.CONNECTING && '连接中...'}
              {callState === CALL_STATES.CONNECTED && '通话中'}
            </small>
          </div>
          <button className="btn ghost" onClick={handleEnd}>✕</button>
        </header>

        {showAnimation ? (
          <div className="video-calling-animation">
            <div className="calling-avatar">{callerInitial}</div>
            <div className="calling-text">{callerName}</div>
            <div className="calling-status">
              {callState === CALL_STATES.DIALING ? '正在呼叫...' : '邀请你视频通话'}
            </div>
          </div>
        ) : (
          <div className="video-grid">
            <video ref={localVideoRef} autoPlay muted playsInline />
            <video ref={remoteVideoRef} autoPlay playsInline />
          </div>
        )}

        {callState === CALL_STATES.RINGING && mode === 'incoming' ? (
          <div className="video-actions">
            <button className="btn primary" onClick={acceptCall}>接听</button>
            <button className="btn secondary" onClick={handleEnd}>拒绝</button>
          </div>
        ) : (
          <div className="video-actions">
            <button className="btn secondary" onClick={handleEnd}>挂断</button>
          </div>
        )}
      </div>
    </div>
  );
}

