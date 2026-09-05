// Appwrite Configuration & Backend Logic
const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6a98502b0023f61a6477';
const DATABASE_ID = '6a9853c300262f68c1fd';
const COLLECTION_MESSAGES = 'messages';
const COLLECTION_GAMES = 'games';
const COLLECTION_PRESENCE = 'presence';

// Initialize Appwrite Client
const { Client, Databases, ID, Query } = Appwrite;

const appwriteClient = new Client();
appwriteClient
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(appwriteClient);
