const {createNodeRedisClient} = require('handy-redis');
const {local} = require("../config");

const localStore = {};

let _exports = {
    get: (key) => localStore[key],
    set: (key, value) => localStore[key] = value,
    roomCount: Object.keys(localStore).filter((key) => key.startsWith("rooms/")).length,
    identityCount: Object.keys(localStore).filter((key) => key.startsWith("identities/")).length
}

if(!local) {
    const client = createNodeRedisClient({host: 'pantryredis'});


    client.on('connect', () => {
        console.log('Redis client connected');
    });

    client.on("error", (error) => {
        console.error(error);
    });
    const _get = client.get;
    const _set = client.set;

    const roomCount = async () => (await client.keys("rooms/*")).length;
    const identityCount = async () => (await client.keys("identities/*")).length;
    const set = (key, value) => _set(key, JSON.stringify(value));
    const get = async (key) => JSON.parse(await _get(key));

    _exports = {
        get,
        set,
        roomCount,
        identityCount
    };

}


module.exports = _exports;
