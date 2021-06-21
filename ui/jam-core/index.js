import {Identity, updateInfo} from './identity';
import {defaultState, actions, defaultProps} from './state';
import {AudioState} from './audio';
import {Reactions} from './reactions';
import {
  RoomState,
  addSpeaker,
  addModerator,
  removeSpeaker,
  removeModerator,
} from './room';
import {is, set, on, update} from 'minimal-state';
import {
  debugStateTree,
  declare,
  declareStateRoot,
  merge,
  use,
  useAction,
} from '../lib/state-tree';
import {debug} from '../lib/state-utils';
import ModeratorState from './room/ModeratorState';
import {staticConfig} from './config';
import Swarm from '../lib/swarm';
import {populateApiCache, createRoom, updateRoom} from './backend';
import {addAdmin, removeAdmin} from './admin';
import ConnectAudio from './connections/ConnectAudio';
import ConnectRoom from './connections/ConnectRoom';
import {StoredState} from '../lib/local-storage';

/* THE JAM API */

export {createJam};
export {importRoomIdentity} from './identity';
export {is, set, on, update};
export {until} from '../lib/state-utils';

function createApi(state, dispatch, setProps) {
  return {
    setProps,
    setState(...args) {
      is(state, ...args);
    },
    onState(...args) {
      return on(state, ...args);
    },
    // create room with the own identity as the only moderator and speaker
    createRoom: (roomId, partialRoom) => createRoom(state, roomId, partialRoom),

    // completely replaces the room, rejects if moderator/speaker array is not set
    // only possible for moderators
    updateRoom: (roomId, room) => updateRoom(state, roomId, room),

    addSpeaker: (roomId, peerId) => addSpeaker(state, roomId, peerId),
    addModerator: (roomId, peerId) => addModerator(state, roomId, peerId),
    removeSpeaker: (roomId, peerId) => removeSpeaker(state, roomId, peerId),
    removeModerator: (roomId, peerId) => removeModerator(state, roomId, peerId),
    addAdmin: peerId => addAdmin(state, peerId),
    removeAdmin: peerId => removeAdmin(state, peerId),

    updateInfo: info => updateInfo(state, info),

    enterRoom: roomId => dispatch(actions.JOIN, roomId),
    leaveRoom: () => dispatch(actions.JOIN, null),
    leaveStage: () => dispatch(actions.LEAVE_STAGE),
    sendReaction: reaction => dispatch(actions.REACTION, reaction),
    retryMic: () => dispatch(actions.RETRY_MIC),
    retryAudio: () => dispatch(actions.RETRY_AUDIO),
    autoJoinOnce: () => dispatch(actions.AUTO_JOIN),
  };
}

function createJam({jamConfig, cachedRooms, debug: debug_ = false} = {}) {
  // setup stuff
  if (jamConfig) set(staticConfig, jamConfig);
  if (cachedRooms) {
    for (let roomId in cachedRooms) {
      populateApiCache(`/rooms/${roomId}`, cachedRooms[roomId]);
    }
  }
  if (debug_ || jamConfig?.development) {
    if (debug_) window.DEBUG = true;
    debugStateTree();
  }

  let props = {...defaultProps, hasMediasoup: !!staticConfig.sfu};
  const {state, dispatch, setProps} = declareStateRoot(AppState, props, {
    defaultState,
  });
  const api = createApi(state, dispatch, setProps);

  if (debug_ || jamConfig?.development) {
    if (debug_) debug(state.swarm);
    window.swarm = state.swarm;
    window.state = state;
    debug(state);
  }
  return [state, api];
}

function AppState({hasMediasoup}) {
  const swarm = Swarm();
  const {peerState, myPeerState} = swarm;
  is(myPeerState, {inRoom: false, micMuted: false, leftStage: false});

  return function AppState({
    roomId,
    userInteracted,
    micMuted,
    autoJoin,
    autoRejoin,
  }) {
    let {myId, myIdentity} = use(Identity, {roomId});

    let {room, hasRoom, iAmSpeaker, iAmModerator} = use(RoomState, {
      roomId,
      myId,
      myIdentity,
      peerState,
      myPeerState,
    });
    let {closed, moderators, speakers} = room;
    let inRoom = use(InRoom, {
      roomId,
      autoJoin,
      autoRejoin,
      iAmModerator,
      hasRoom,
      closed,
    });

    // connect with signaling server
    declare(ConnectRoom, {
      swarm,
      myId,
      myIdentity,
      roomId,
      shouldConnect: hasRoom,
    });
    declare(ModeratorState, {swarm, moderators});

    let remoteStreams = use(ConnectAudio, {
      hasMediasoup,
      swarm,
      roomId,
      iAmSpeaker,
      speakers,
    });

    is(myPeerState, {micMuted, inRoom: !!inRoom});
    declare(Reactions, {swarm});

    return merge(
      {
        swarm,
        roomId,
        micMuted,
        inRoom,
        room,
        iAmSpeaker,
        iAmModerator,
        myId,
        myIdentity,
      },
      declare(AudioState, {
        myId,
        inRoom,
        iAmSpeaker,
        swarm,
        remoteStreams,
        userInteracted,
        micMuted,
      })
    );
  };
}

function InRoom() {
  let inRoom = null;
  let autoJoinCount = 0;
  let didAutoJoin = false;
  const joinedRooms = StoredState('jam.joinedRooms', () => ({}));

  return function InRoom({
    roomId,
    autoJoin,
    autoRejoin,
    iAmModerator,
    hasRoom,
    closed,
  }) {
    let [isJoinRoom, joinedRoomId] = useAction(actions.JOIN);
    let [isAutoJoin] = useAction(actions.AUTO_JOIN);
    if ((isAutoJoin || (autoJoin && !didAutoJoin)) && autoJoinCount === 0) {
      didAutoJoin = true;
      autoJoinCount = 1;
    }

    if (!roomId || (closed && !iAmModerator)) {
      inRoom = null;
    } else {
      if (isJoinRoom) {
        inRoom = joinedRoomId; // can be null, for leaving room
      } else if (autoRejoin && hasRoom && joinedRooms[roomId]) {
        inRoom = roomId;
      }
      if (autoJoinCount > 0 && hasRoom) {
        autoJoinCount--;
        inRoom = roomId;
      }
    }

    if (autoRejoin) is(joinedRooms, roomId, inRoom !== null || undefined);
    return inRoom;
  };
}
