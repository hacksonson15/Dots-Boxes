// --- APPWRITE INITIALIZATION ---
const { Client, Databases, ID, Query } = Appwrite;

const appwriteClient = new Client();
appwriteClient
    .setEndpoint('https://fra.cloud.appwrite.io/v1')
    .setProject('6a98502b0023f61a6477');

const databases = new Databases(appwriteClient);
const DATABASE_ID = '6a9853c300262f68c1fd';
const COLLECTION_MESSAGES = 'messages';
const COLLECTION_GAMES = 'games';
const COLLECTION_PRESENCE = 'presence';