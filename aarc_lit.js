import {
    LitAuthClient,
    // StytchOtpProvider,
    // StytchAuthFactorOtpProvider
} from "@lit-protocol/lit-auth-client/src/index.js";
// import prompts from "prompts";
// import * as stytch from "stytch";
import * as LitJsSdk from "@lit-protocol/lit-node-client-nodejs";
import { AuthMethodType } from "@lit-protocol/constants";
// import { LitAbility, LitPKPResource, LitActionResource } from "@lit-protocol/auth-helpers";
// import { PKPEthersWallet } from "@lit-protocol/pkp-ethers";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import {ethers, providers} from 'ethers';
import * as siwe from 'siwe';
import * as dotenv from 'dotenv';
import * as ethUtil from 'ethereumjs-util';

dotenv.config();
  
  //@ts-ignore
const ls = await import('node-localstorage');

const run = async()=>{
  // Initialize LitNodeClient
  const litNodeClient = new LitJsSdk.LitNodeClientNodeJs({
    alertWhenUnauthorized: false,
    litNetwork: 'cayenne',
    debug: false,
});
await litNodeClient.connect();

let nonce = litNodeClient.getLatestBlockhash();

// Initialize the signer
const provider = new ethers.providers.JsonRpcProvider('https://chain-rpc.litprotocol.com/http');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const address = wallet.address;

// Craft the SIWE message
const domain = 'localhost';
const origin = 'https://localhost/login';
const statement =
'This is a test statement.  You can put anything you want here!';

// expiration time in ISO 8601 format.  This is 1 day in the future, calculated in milliseconds
const expirationTime = new Date(
Date.now() + 60 * 60 * 24 * 1 * 10000
).toISOString();

const siweMessage = new siwe.SiweMessage({
domain,
address: address,
statement,
uri: origin,
version: '1',
chainId: 1,
nonce,
expirationTime,
});
const messageToSign = siweMessage.prepareMessage();

// Sign the message and format the authSig
const signature = await wallet.signMessage(messageToSign);

const authSig = {
sig: signature,
derivedVia: 'web3.eth.personal.sign',
signedMessage: messageToSign,
address: address,
};

// console.log(authSig);
console.log("ok")

    const computeCFAFromUserID = async(userId)=>{
        console.log('UserId: ', userId);
        const keyId = litNodeClient.computeHDKeyId(
          userId,
          process.env.LIT_RELAY_API_KEY,  // what project id shoul we enter here?
          true,
        );
        console.log('KeyId: ', keyId); 

        const publicKey = litNodeClient.computeHDPubKey(keyId.slice(2));
    const pubKeyBuffer = Buffer.from(publicKey, 'hex');
    const ethAddress = ethers.utils.computeAddress(pubKeyBuffer);

        // const publicKey = litNodeClient.computeHDPubKey(keyId.slice(2));
        console.log('PublicKey: ', publicKey);

        // // const pubKeyBuffer = Buffer.from(publicKey, 'hex');
        // const pubKeyBuffer = Buffer.from(publicKey.slice(0, 2) === '04' ? publicKey.slice(2) : publicKey, 'hex');
        console.log('PubKeyBuffer: ', pubKeyBuffer);

        //   // Compute the Ethereum address
        // const addressBuffer = ethUtil.pubToAddress(pubKeyBuffer, true);
        // const address = addressBuffer.toString('hex');
        // // Add the '0x' prefix to the address
        // const ethAddress = `0x${address}`;

        console.log('EthAddress: ', ethAddress);
        return {
          keyId: keyId,
          publicKey: publicKey,
          ethAddress: ethAddress,
        };
      }
      
      await computeCFAFromUserID('userId');


      const claimKeyId = async(userId, authId, authMethod) => {
        const contractClient = new LitContracts({ signer: wallet, provider: provider});
        await contractClient.connect();

        const res = await litNodeClient.executeJs({
          // authSig: await this.getControllerAuthSig(80001),
          authSig: authSig,
          code: `(async () => {
            Lit.Actions.claimKey({keyId: userId});
          })();`,
          authMethods: [],
          jsParams: {
            userId: userId,
          },
        });
        console.log('Res', res);

        // let res1 = await litNodeClient.claimKeyId({
        //   authMethod, // provide an auth method to claim a key Identifier mapped to the given auth method
        // });
        // console.log('Res1', res1);
        // console.log("mint tx hash: ", res1.mintTx);
        // console.log("pkp public key: ", res1.pubkey);


        const mintCost = await contractClient.pkpNftContract.read.mintCost();
        console.log('MintCost', mintCost);

        const tx =
          // await contractClient.pkpNftContract.write.claimAndMint(
          //   // {
          //     2,
          //     res.claims[userId].derivedKeyId,
          //     res.claims[userId].signatures,
          //     mintCost,
          //   // },
          await contractClient.pkpHelperContract.write.claimAndMintNextAndAddAuthMethods(
            {
              keyType: 2,
              derivedKeyId: `0x${res.claims[userId].derivedKeyId}`,
              signatures: res.claims[userId].signatures,
            },
            // res.claims[userId],
            {
             keyType: 2,
             permittedIpfsCIDs: [],
             permittedIpfsCIDScopes: [],
             permittedAddresses: [],
             permittedAddressScopes: [],
             permittedAuthMethodTypes: [AuthMethodType.EthWallet],
             permittedAuthMethodIds: [authId],
             permittedAuthMethodPubkeys: [`0x`],
             permittedAuthMethodScopes: [[ethers.BigNumber.from('1')]],
             addPkpEthAddressAsPermittedAddress: true,
             sendPkpToItself: true
            },
            // {
            //   keyType: 2,
            //   permittedIpfsCIDs: [],
            //   permittedIpfsCIDScopes: [],
            //   permittedAddresses: [],
            //   permittedAddressScopes: [],
            //   permittedAuthMethodTypes: [1],
            //   permittedAuthMethodIds: [authId],
            //   permittedAuthMethodPubkeys: [`0x`],
            //   permittedAuthMethodScopes: [[ethers.BigNumber.from('1')]],
            //   addPkpEthAddressAsPermittedAddress: true,
            //   sendPkpToItself: true,
            // },
            // {
            //   value: mintCost,
            // }
            { value: mintCost, gasPrice: ethers.utils.parseUnits("0.001", "gwei"), gasLimit: 2000000 }
          );
        return tx;
      }

      const authMethodWallet = {
        authMethodType: AuthMethodType.EthWallet, // Adjust based on the auth method
        accessToken: JSON.stringify(authSig),  // Use authSig obtained from the controller wallet
      };

      const authId = await LitAuthClient.getAuthIdByAuthMethod(authMethodWallet);
      console.log('AuthId: ', authId);
      console.log("-----------------------")

      const tx = await claimKeyId('userId', authId, authMethodWallet);
        console.log("tx", tx);
        console.log("-----------------------")

      const receipt = await tx.wait();
        console.log("receipt", receipt);
        console.log("-----------------------")
    
}

run();