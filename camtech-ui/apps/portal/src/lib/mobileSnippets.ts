// Mobile integration samples: the web SDK inside a WebView (bridge page or hosted page), and the native REST flow.
// Pre-filled for the tenant like snippets.ts; never includes a secret.
import { hostedQuery, originOf, type Snippet, type SnippetContext } from './snippets';

export type MobilePlatform = 'ios' | 'android' | 'react-native' | 'flutter';

const BRIDGE_URL = 'https://your-app.example/camtech/mobile.html';
const RETURN_URL = 'https://your-app.example/kyc/done';

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The page the WebView loads, with the options in the fragment (never in the query). */
export function webViewUrls(c: SnippetContext): { bridge: string; hosted: string } {
  return {
    bridge: `${BRIDGE_URL}#sdkToken=<sdkToken>&${hostedQuery(c)}`,
    hosted: `${c.sdkUrl}/?${hostedQuery(c)}&returnUrl=${encodeURIComponent(RETURN_URL)}#sdkToken=<sdkToken>`,
  };
}

// ---------------------------------------------------------------- the bridge page (hosted on your website)
export function bridgePageSnippet(c: SnippetContext): Snippet {
  return {
    key: 'bridge',
    label: 'mobile.html',
    lang: 'html',
    code: `<!doctype html>
<!-- Host this page on YOUR website over https, e.g. ${BRIDGE_URL}
     One page for iOS, Android, React Native and Flutter: it runs the CamTech SDK full screen and
     forwards every SDK event (with the signed resultToken) to the native app. -->
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Verification</title>
  <style>html, body, #kyc { margin: 0; height: 100%; }</style>
  <script src="${c.sdkUrl}/camtech-sdk.js"></script>
</head>
<body>
  <div id="kyc"></div>
  <script>
    // Send a message to the native app, whatever WebView we are in.
    function toApp(type, payload) {
      var msg = JSON.stringify({ type: type, payload: payload });
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);          // React Native
      else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.camtech)
        window.webkit.messageHandlers.camtech.postMessage(msg);                            // iOS (WKWebView)
      else if (window.CamtechAndroid) window.CamtechAndroid.postMessage(msg);             // Android (WebView)
      else if (window.CamtechBridge) window.CamtechBridge.postMessage(msg);               // Flutter
    }

    // The app opens this page as mobile.html#sdkToken=…&journey=…&lang=…
    var p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname); // remove the token from the address bar

    Camtech.init({
      mode: 'inline',
      container: '#kyc',
      apiBaseUrl: '${c.baseUrl}',
      sdkToken: p.get('sdkToken'),
      journey: (p.get('journey') || '${c.journey.join(',')}').split(','),
      lang: p.get('lang') === 'ar' ? 'ar' : 'en',
      enrollFace: p.has('enrollFace') ? p.get('enrollFace') === 'true' : undefined,
      onReady: function () { toApp('ready', null); },
      onStep: function (s) { toApp('step', s); },
      onComplete: function (r) { toApp('complete', r); },   // { results: [{ flow, sessionId, decision, resultToken, … }] }
      onCancel: function (c) { toApp('cancel', c); },
      onError: function (e) { toApp('error', e); },         // close the WebView when e.fatal is true
    });
  </script>
</body>
</html>`,
  };
}

// ---------------------------------------------------------------- per platform: setup + WebView screen
export function webViewSnippets(c: SnippetContext, platform: MobilePlatform): Snippet[] {
  const hosts = `"${hostOf(BRIDGE_URL)}", "${hostOf(c.sdkUrl)}"`;
  const q = hostedQuery(c);
  switch (platform) {
    case 'ios':
      return [
        {
          key: 'setup',
          label: 'Info.plist',
          lang: 'xml',
          code: `<!-- Required: without it the app crashes the first time the camera is used. -->
<key>NSCameraUsageDescription</key>
<string>We use the camera to verify your identity.</string>

<!-- Minimum iOS 14.3 (camera in WKWebView); iOS 15+ recommended for the permission delegate below. -->`,
        },
        {
          key: 'screen',
          label: 'VerificationViewController.swift',
          lang: 'swift',
          code: `import UIKit
import WebKit

/// Runs the CamTech verification in a WKWebView and reports how it ended.
final class VerificationViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private let startUrl: URL
    /// Hosted page only: where CamTech sends the user at the end. Caught here, never loaded.
    private let returnUrl = "${RETURN_URL}"
    /// Pages allowed to use the camera: your bridge page and the CamTech SDK host.
    private let allowedHosts: Set<String> = [${hosts}]
    /// type = "complete" | "cancel" | "error" | "return"
    var onFinish: ((_ type: String, _ payload: Any?) -> Void)?
    private var webView: WKWebView!

    init(startUrl: URL) {
        self.startUrl = startUrl
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true                 // camera preview inside the page
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "camtech") // window.webkit.messageHandlers.camtech
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: startUrl))
    }

    // Camera permission for the page (iOS 15+). The system camera prompt is still shown once per app.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(allowedHosts.contains(origin.host) && type == .camera ? .grant : .deny)
    }

    // Bridge page: SDK events sent with toApp(type, payload).
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String,
              let msg = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let type = msg["type"] as? String else { return }
        let payload = msg["payload"]
        let fatal = (payload as? [String: Any])?["fatal"] as? Bool == true
        if type == "complete" || type == "cancel" || (type == "error" && fatal) {
            finish(type, payload)
        }
    }

    // Hosted page: catch the return URL; only allow your page and the SDK host inside the WebView.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.absoluteString.hasPrefix(returnUrl) {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let value = { (name: String) in items.first { $0.name == name }?.value }
            decisionHandler(.cancel)
            finish("return", ["sessionId": value("camtechSessionId"), "status": value("camtechStatus")])
            return
        }
        decisionHandler(allowedHosts.contains(url.host ?? "") || url.scheme == "about" ? .allow : .cancel)
    }

    private func finish(_ type: String, _ payload: Any?) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "camtech")
        dismiss(animated: true) { self.onFinish?(type, payload) }
    }
}`,
        },
        {
          key: 'open',
          label: 'Open it',
          lang: 'swift',
          code: `// 1. Ask YOUR backend for an SDK token (it calls POST /v2/sdk-tokens with the app's API key).
let sdkToken = try await api.createSdkToken()

// 2. Build the URL: options in the fragment, never in the query.
var components = URLComponents(string: "${BRIDGE_URL}")!
components.fragment = "sdkToken=\\(sdkToken)&${q}"
// Hosted page instead of the bridge page:
//   "${c.sdkUrl}/?${q}&returnUrl=${encodeURIComponent(RETURN_URL)}#sdkToken=\\(sdkToken)"

let vc = VerificationViewController(startUrl: components.url!)
vc.onFinish = { type, payload in
    switch type {
    case "complete":
        // Send the whole payload to YOUR backend; it verifies each resultToken (see "Verify the result").
        Task { try await api.postKycResult(payload) }
    case "return":
        // Hosted page: your backend reads the result for this sessionId (or waits for the webhook).
        Task { try await api.refreshKycStatus() }
    default:
        break // cancelled, or a fatal error: let the user try again
    }
}
present(vc, animated: true)`,
        },
      ];
    case 'android':
      return [
        {
          key: 'setup',
          label: 'AndroidManifest.xml',
          lang: 'xml',
          code: `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />

    <application>
        <activity
            android:name=".VerificationActivity"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:exported="false" />
    </application>
</manifest>

<!-- build.gradle: implementation "androidx.activity:activity-ktx" and "androidx.appcompat:appcompat".
     The camera in a WebView needs an up-to-date Android System WebView / Chrome (Android 7+). -->`,
        },
        {
          key: 'screen',
          label: 'VerificationActivity.kt',
          lang: 'kotlin',
          code: `import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject

/** Runs the CamTech verification in a WebView and returns how it ended. */
class VerificationActivity : AppCompatActivity() {
    private val returnUrl = "${RETURN_URL}"            // hosted page only
    private val allowedHosts = setOf(${hosts})
    private lateinit var webView: WebView
    private var pendingRequest: PermissionRequest? = null

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingRequest?.let { if (granted) it.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else it.deny() }
        pendingRequest = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false   // camera preview starts without a tap
        }
        webView.addJavascriptInterface(Bridge(), "CamtechAndroid") // window.CamtechAndroid.postMessage(…)

        webView.webChromeClient = object : WebChromeClient() {
            // The page asks for the camera: grant it to our pages only, after the Android permission.
            override fun onPermissionRequest(request: PermissionRequest) {
                if (request.origin.host !in allowedHosts ||
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE !in request.resources) {
                    request.deny(); return
                }
                val ok = ContextCompat.checkSelfPermission(this@VerificationActivity, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED
                if (ok) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                else { pendingRequest = request; cameraPermission.launch(Manifest.permission.CAMERA) }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.toString().startsWith(returnUrl)) {   // hosted page finished
                    finishWith("return", JSONObject()
                        .put("sessionId", url.getQueryParameter("camtechSessionId"))
                        .put("status", url.getQueryParameter("camtechStatus")))
                    return true
                }
                return url.host !in allowedHosts               // never load other sites in this WebView
            }
        }
        webView.loadUrl(requireNotNull(intent.getStringExtra(EXTRA_URL)))
    }

    /** Bridge page: SDK events sent with toApp(type, payload). Called on a background thread. */
    private inner class Bridge {
        @JavascriptInterface
        fun postMessage(json: String) {
            val msg = JSONObject(json)
            val type = msg.getString("type")
            val payload = msg.optJSONObject("payload")
            val fatal = type == "error" && payload?.optBoolean("fatal") == true
            if (type == "complete" || type == "cancel" || fatal) runOnUiThread { finishWith(type, payload) }
        }
    }

    private fun finishWith(type: String, payload: JSONObject?) {
        setResult(RESULT_OK, Intent().putExtra(RESULT_TYPE, type).putExtra(RESULT_PAYLOAD, payload?.toString()))
        finish()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "url"
        const val RESULT_TYPE = "type"       // complete | cancel | error | return
        const val RESULT_PAYLOAD = "payload" // JSON
    }
}`,
        },
        {
          key: 'open',
          label: 'Open it',
          lang: 'kotlin',
          code: `private val verification = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val data = result.data ?: return@registerForActivityResult
    when (data.getStringExtra(VerificationActivity.RESULT_TYPE)) {
        // Send the payload to YOUR backend; it verifies each resultToken (see "Verify the result").
        "complete" -> lifecycleScope.launch { api.postKycResult(data.getStringExtra(VerificationActivity.RESULT_PAYLOAD)!!) }
        // Hosted page: your backend reads the result for this sessionId (or waits for the webhook).
        "return" -> lifecycleScope.launch { api.refreshKycStatus() }
        else -> Unit // cancelled, or a fatal error: let the user try again
    }
}

fun startVerification() = lifecycleScope.launch {
    // 1. Ask YOUR backend for an SDK token (it calls POST /v2/sdk-tokens with the app's API key).
    val sdkToken = api.createSdkToken()
    // 2. Options in the fragment, never in the query.
    val url = "${BRIDGE_URL}#sdkToken=\${Uri.encode(sdkToken)}&${q}"
    // Hosted page instead: "${c.sdkUrl}/?${q}&returnUrl=${encodeURIComponent(RETURN_URL)}#sdkToken=\${Uri.encode(sdkToken)}"
    verification.launch(Intent(this@MainActivity, VerificationActivity::class.java).putExtra(VerificationActivity.EXTRA_URL, url))
}`,
        },
      ];
    case 'react-native':
      return [
        {
          key: 'setup',
          label: 'Install & permissions',
          lang: 'bash',
          code: `npm install react-native-webview
cd ios && pod install && cd ..

# iOS — ios/<App>/Info.plist
#   <key>NSCameraUsageDescription</key>
#   <string>We use the camera to verify your identity.</string>
#
# Android — android/app/src/main/AndroidManifest.xml
#   <uses-permission android:name="android.permission.CAMERA" />
#
# Expo: npx expo install react-native-webview, then add the same texts under
#   "ios.infoPlist.NSCameraUsageDescription" and "android.permissions": ["CAMERA"] in app.json.`,
        },
        {
          key: 'screen',
          label: 'VerificationScreen.tsx',
          lang: 'tsx',
          code: `import { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

const RETURN_URL = '${RETURN_URL}'; // hosted page only
const ALLOWED_HOSTS = [${hosts}];

type Finish = (type: 'complete' | 'cancel' | 'error' | 'return', payload: any) => void;

const hostOf = (url: string) => url.replace(/^https?:\\/\\//, '').split(/[/?#]/)[0];
const param = (url: string, name: string) => {
  const m = url.match(new RegExp('[?&]' + name + '=([^&#]*)'));
  return m ? decodeURIComponent(m[1]) : null;
};

export function VerificationScreen({ url, onFinish }: { url: string; onFinish: Finish }) {
  const [cameraOk, setCameraOk] = useState(Platform.OS === 'ios'); // iOS asks by itself

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).then((r) =>
      r === PermissionsAndroid.RESULTS.GRANTED
        ? setCameraOk(true)
        : onFinish('error', { code: 'CAMERA_PERMISSION_DENIED', fatal: true }),
    );
  }, [onFinish]);

  // Bridge page: SDK events sent with toApp(type, payload).
  const onMessage = (e: WebViewMessageEvent) => {
    const msg = JSON.parse(e.nativeEvent.data);
    if (msg.type === 'complete' || msg.type === 'cancel' || (msg.type === 'error' && msg.payload?.fatal)) {
      onFinish(msg.type, msg.payload);
    }
  };

  if (!cameraOk) return null;
  return (
    <WebView
      source={{ uri: url }}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback                    // camera preview inside the page (iOS)
      mediaPlaybackRequiresUserAction={false}
      mediaCapturePermissionGrantType="grantIfSameHostElsePrompt" // iOS 15+
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req) => {
        if (req.url.startsWith(RETURN_URL)) {      // hosted page finished
          onFinish('return', { sessionId: param(req.url, 'camtechSessionId'), status: param(req.url, 'camtechStatus') });
          return false;
        }
        return ALLOWED_HOSTS.includes(hostOf(req.url)) || req.url === 'about:blank';
      }}
    />
  );
}`,
        },
        {
          key: 'open',
          label: 'Open it',
          lang: 'tsx',
          code: `// 1. Ask YOUR backend for an SDK token (it calls POST /v2/sdk-tokens with the app's API key).
const { sdkToken } = await api.post('/api/kyc/sdk-token');

// 2. Options in the fragment, never in the query.
const url = \`${BRIDGE_URL}#sdkToken=\${encodeURIComponent(sdkToken)}&${q}\`;
// Hosted page instead: \`${c.sdkUrl}/?${q}&returnUrl=${encodeURIComponent(RETURN_URL)}#sdkToken=\${encodeURIComponent(sdkToken)}\`

navigation.navigate('Verification', { url });

// In the screen:
<VerificationScreen
  url={route.params.url}
  onFinish={async (type, payload) => {
    if (type === 'complete') await api.post('/api/kyc/result', payload); // backend verifies the resultToken(s)
    if (type === 'return') await api.get('/api/kyc/status');            // hosted page: backend reads the result
    navigation.goBack();
  }}
/>`,
        },
      ];
    case 'flutter':
      return [
        {
          key: 'setup',
          label: 'Install & permissions',
          lang: 'bash',
          code: `flutter pub add webview_flutter webview_flutter_android webview_flutter_wkwebview permission_handler

# iOS — ios/Runner/Info.plist
#   <key>NSCameraUsageDescription</key>
#   <string>We use the camera to verify your identity.</string>
# iOS — ios/Podfile (permission_handler only compiles the permissions you enable):
#   post_install do |installer|
#     installer.pods_project.targets.each do |target|
#       flutter_additional_ios_build_settings(target)
#       target.build_configurations.each do |config|
#         config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)', 'PERMISSION_CAMERA=1']
#       end
#     end
#   end
#
# Android — android/app/src/main/AndroidManifest.xml
#   <uses-permission android:name="android.permission.INTERNET" />
#   <uses-permission android:name="android.permission.CAMERA" />`,
        },
        {
          key: 'screen',
          label: 'verification_page.dart',
          lang: 'dart',
          code: `import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

const returnUrl = '${RETURN_URL}'; // hosted page only
const allowedHosts = {${hosts}};

/// Pops with {'type': 'complete' | 'cancel' | 'error' | 'return', 'payload': ...}.
class VerificationPage extends StatefulWidget {
  const VerificationPage({super.key, required this.url});
  final String url;

  @override
  State<VerificationPage> createState() => _VerificationPageState();
}

class _VerificationPageState extends State<VerificationPage> {
  late final WebViewController _controller;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    final params = WebViewPlatform.instance is WebKitWebViewPlatform
        ? WebKitWebViewControllerCreationParams(
            allowsInlineMediaPlayback: true, // camera preview inside the page
            mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
          )
        : const PlatformWebViewControllerCreationParams();

    _controller = WebViewController.fromPlatformCreationParams(
      params,
      // The page asks for the camera: grant it to our pages only, after the OS permission.
      onPermissionRequest: (request) async {
        final host = Uri.tryParse(widget.url)?.host ?? '';
        if (request.types.contains(WebViewPermissionResourceType.camera) &&
            allowedHosts.contains(host) &&
            await Permission.camera.request().isGranted) {
          await request.grant();
        } else {
          await request.deny();
        }
      },
    )
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      // Bridge page: SDK events sent with toApp(type, payload) → window.CamtechBridge.postMessage
      ..addJavaScriptChannel('CamtechBridge', onMessageReceived: (m) {
        final msg = jsonDecode(m.message) as Map<String, dynamic>;
        final type = msg['type'] as String;
        final payload = msg['payload'];
        final fatal = type == 'error' && payload is Map && payload['fatal'] == true;
        if (type == 'complete' || type == 'cancel' || fatal) _finish(type, payload);
      })
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (request) {
          if (request.url.startsWith(returnUrl)) { // hosted page finished
            final q = Uri.parse(request.url).queryParameters;
            _finish('return', {'sessionId': q['camtechSessionId'], 'status': q['camtechStatus']});
            return NavigationDecision.prevent;
          }
          final host = Uri.tryParse(request.url)?.host ?? '';
          return allowedHosts.contains(host) ? NavigationDecision.navigate : NavigationDecision.prevent;
        },
      ));

    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(false);
    }
    _controller.loadRequest(Uri.parse(widget.url));
  }

  void _finish(String type, Object? payload) {
    if (_done || !mounted) return;
    _done = true;
    Navigator.of(context).pop({'type': type, 'payload': payload});
  }

  @override
  Widget build(BuildContext context) =>
      Scaffold(body: SafeArea(child: WebViewWidget(controller: _controller)));
}`,
        },
        {
          key: 'open',
          label: 'Open it',
          lang: 'dart',
          code: `// 1. Ask YOUR backend for an SDK token (it calls POST /v2/sdk-tokens with the app's API key).
final sdkToken = await api.createSdkToken();

// 2. Options in the fragment, never in the query.
final url = '${BRIDGE_URL}#sdkToken=\${Uri.encodeComponent(sdkToken)}&${q}';
// Hosted page instead: '${c.sdkUrl}/?${q}&returnUrl=${encodeURIComponent(RETURN_URL)}#sdkToken=\${Uri.encodeComponent(sdkToken)}'

final result = await Navigator.of(context).push<Map<String, dynamic>>(
  MaterialPageRoute(builder: (_) => VerificationPage(url: url)),
);
switch (result?['type']) {
  case 'complete':
    await api.postKycResult(result!['payload']); // backend verifies each resultToken
  case 'return':
    await api.refreshKycStatus();               // hosted page: backend reads the result
  default:
    break; // cancelled, or a fatal error: let the user try again
}`,
        },
      ];
  }
}

// ---------------------------------------------------------------- native: call the REST API from your own screens
export function nativeApiSnippets(c: SnippetContext): Snippet[] {
  return [
    {
      key: 'http',
      label: 'Calls in order',
      lang: 'http',
      code: `# Every call: X-Sdk-Token: <sdkToken from your backend>, X-Platform: IOS | ANDROID, X-Device-Id, Accept-Language: ${c.lang}
# Calls on one verification also send: Authorization: Bearer <sessionToken>

GET  ${c.baseUrl}/v2/capabilities                       → flows, documents, limits, livenessMode (cache with ETag)

POST ${c.baseUrl}/v2/selfie-verifications               { "subjectRef": "usr_8812", "documentType": "EMIRATES_ID" }
                                                          → 201 { sessionId, sessionToken, expiresAt, nextStep: "LIVENESS" }

POST ${c.baseUrl}/v2/liveness-challenges                { "sessionId": "…", "supportedActions": ["TURN_LEFT","TURN_RIGHT","BLINK"] }
                                                          → 201 { challengeId, actions: ["TURN_LEFT","BLINK"], expiresAt }
                                                          (only when livenessMode = ACTIVE; a new one for every attempt)

POST ${c.baseUrl}/v2/selfie-verifications/{id}/liveness multipart: normal=<jpeg>, challengeId, challengeFrames=<jpeg> ×≤16
                                                          → 200 { result: "PASSED", nextStep: "DOCUMENT" }
                                                          → 422 { code: "TOO_DARK", message, attemptsRemaining, nextStep: "LIVENESS" }

POST ${c.baseUrl}/v2/selfie-verifications/{id}/document multipart: documentType, document=<jpeg>, documentNumber, expiryDate[, mrzLine2]
                                                          → 200 { result: "MATCH", decision: "APPROVED", nextStep: "DONE" }
                                                          → 200 { result: "REVIEW", nextStep: "DOCUMENT" }  (rescan)

GET  ${c.baseUrl}/v2/selfie-verifications/{id}/result   → { decision, resultToken }  → send resultToken to YOUR backend

# One-call flows (same multipart fields as liveness, plus subjectRef):
POST ${c.baseUrl}/v2/face-authentications   POST ${c.baseUrl}/v2/liveness-checks   POST ${c.baseUrl}/v2/face-enrollments
                                                          → { sessionId, decision, reasonCode, message, resultToken }`,
    },
    {
      key: 'kotlin',
      label: 'Kotlin (OkHttp)',
      lang: 'kotlin',
      code: `// implementation("com.squareup.okhttp3:okhttp:4.12.0")
class CamtechApi(private val sdkToken: String, private val deviceId: String, private val lang: String = "${c.lang}") {
    private val base = "${c.baseUrl}"
    private val http = OkHttpClient()
    private val json = "application/json".toMediaType()
    private val jpeg = "image/jpeg".toMediaType()

    private fun request(path: String, sessionToken: String? = null) = Request.Builder()
        .url(base + path)
        .header("X-Sdk-Token", sdkToken)
        .header("X-Platform", "ANDROID")
        .header("X-Device-Id", deviceId)
        .header("X-OS-Version", Build.VERSION.RELEASE)
        .header("X-Device-Model", Build.MODEL)
        .header("Accept-Language", lang)
        .apply { if (sessionToken != null) header("Authorization", "Bearer $sessionToken") }

    /** Returns the body; throws CamtechError with the API code and a message ready to show. */
    private fun call(req: Request): JSONObject = http.newCall(req).execute().use { res ->
        val body = JSONObject(res.body?.string().takeUnless { it.isNullOrEmpty() } ?: "{}")
        if (!res.isSuccessful) throw CamtechError(res.code, body.optString("code"), body.optString("message"),
            body.optString("nextStep").ifEmpty { null }, body.optInt("attemptsRemaining", -1))
        body
    }

    fun start(subjectRef: String, documentType: String) = call(request("/v2/selfie-verifications")
        .post(JSONObject().put("subjectRef", subjectRef).put("documentType", documentType).toString().toRequestBody(json)).build())

    fun challenge(sessionId: String, sessionToken: String) = call(request("/v2/liveness-challenges", sessionToken)
        .post(JSONObject().put("sessionId", sessionId)
            .put("supportedActions", JSONArray(listOf("TURN_LEFT", "TURN_RIGHT", "BLINK"))).toString().toRequestBody(json)).build())

    fun liveness(sessionId: String, sessionToken: String, normal: ByteArray, challengeId: String?, frames: List<ByteArray>): JSONObject {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("normal", "normal.jpg", normal.toRequestBody(jpeg))
        if (challengeId != null) {
            form.addFormDataPart("challengeId", challengeId)
            frames.forEachIndexed { i, f -> form.addFormDataPart("challengeFrames", "frame-$i.jpg", f.toRequestBody(jpeg)) }
        }
        return call(request("/v2/selfie-verifications/$sessionId/liveness", sessionToken).post(form.build()).build())
    }

    fun document(sessionId: String, sessionToken: String, type: String, image: ByteArray, number: String?, expiry: String?) =
        call(request("/v2/selfie-verifications/$sessionId/document", sessionToken).post(
            MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("documentType", type)
                .addFormDataPart("document", "document.jpg", image.toRequestBody(jpeg))
                .apply { number?.let { addFormDataPart("documentNumber", it) }; expiry?.let { addFormDataPart("expiryDate", it) } }
                .build()).build())

    fun result(sessionId: String, sessionToken: String) =
        call(request("/v2/selfie-verifications/$sessionId/result", sessionToken).get().build())
}

class CamtechError(val status: Int, val code: String, override val message: String, val nextStep: String?, val attemptsRemaining: Int) : Exception(message)

// Drive the screens from nextStep: LIVENESS → retake selfies · DOCUMENT → (re)scan · DONE → read the result.
// Run these calls off the main thread (Dispatchers.IO).`,
    },
    {
      key: 'swift',
      label: 'Swift (URLSession)',
      lang: 'swift',
      code: `import Foundation
import UIKit

struct CamtechError: Error { let status: Int; let code: String; let message: String; let nextStep: String?; let attemptsRemaining: Int? }

final class CamtechAPI {
    private let base = URL(string: "${c.baseUrl}")!
    private let sdkToken: String
    private let lang: String

    init(sdkToken: String, lang: String = "${c.lang}") { self.sdkToken = sdkToken; self.lang = lang }

    private func request(_ path: String, method: String = "GET", sessionToken: String? = nil) -> URLRequest {
        var r = URLRequest(url: base.appendingPathComponent(path))
        r.httpMethod = method
        r.setValue(sdkToken, forHTTPHeaderField: "X-Sdk-Token")
        r.setValue("IOS", forHTTPHeaderField: "X-Platform")
        r.setValue(UIDevice.current.identifierForVendor?.uuidString, forHTTPHeaderField: "X-Device-Id")
        r.setValue(UIDevice.current.systemVersion, forHTTPHeaderField: "X-OS-Version")
        r.setValue(lang, forHTTPHeaderField: "Accept-Language")
        if let t = sessionToken { r.setValue("Bearer \\(t)", forHTTPHeaderField: "Authorization") }
        return r
    }

    private func send(_ r: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(for: r)
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw CamtechError(status: status, code: body["code"] as? String ?? "", message: body["message"] as? String ?? "",
                               nextStep: body["nextStep"] as? String, attemptsRemaining: body["attemptsRemaining"] as? Int)
        }
        return body
    }

    func start(subjectRef: String, documentType: String) async throws -> [String: Any] {
        var r = request("v2/selfie-verifications", method: "POST")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: ["subjectRef": subjectRef, "documentType": documentType])
        return try await send(r) // sessionId, sessionToken, nextStep
    }

    func liveness(sessionId: String, sessionToken: String, normal: Data, challengeId: String?, frames: [Data]) async throws -> [String: Any] {
        var form = Multipart()
        form.file("normal", "normal.jpg", normal)
        if let challengeId {
            form.field("challengeId", challengeId)
            for (i, f) in frames.enumerated() { form.file("challengeFrames", "frame-\\(i).jpg", f) }
        }
        return try await send(form.apply(to: request("v2/selfie-verifications/\\(sessionId)/liveness", method: "POST", sessionToken: sessionToken)))
    }

    func document(sessionId: String, sessionToken: String, type: String, image: Data, number: String?, expiry: String?) async throws -> [String: Any] {
        var form = Multipart()
        form.field("documentType", type)
        form.file("document", "document.jpg", image)
        if let number { form.field("documentNumber", number) }
        if let expiry { form.field("expiryDate", expiry) }
        return try await send(form.apply(to: request("v2/selfie-verifications/\\(sessionId)/document", method: "POST", sessionToken: sessionToken)))
    }

    func result(sessionId: String, sessionToken: String) async throws -> [String: Any] {
        try await send(request("v2/selfie-verifications/\\(sessionId)/result", sessionToken: sessionToken)) // decision, resultToken
    }
}

/// Minimal multipart/form-data builder.
struct Multipart {
    private let boundary = "camtech-\\(UUID().uuidString)"
    private var body = Data()
    mutating func field(_ name: String, _ value: String) {
        body.append(Data("--\\(boundary)\\r\\nContent-Disposition: form-data; name=\\"\\(name)\\"\\r\\n\\r\\n\\(value)\\r\\n".utf8))
    }
    mutating func file(_ name: String, _ filename: String, _ data: Data) {
        body.append(Data("--\\(boundary)\\r\\nContent-Disposition: form-data; name=\\"\\(name)\\"; filename=\\"\\(filename)\\"\\r\\nContent-Type: image/jpeg\\r\\n\\r\\n".utf8))
        body.append(data)
        body.append(Data("\\r\\n".utf8))
    }
    func apply(to request: URLRequest) -> URLRequest {
        var r = request
        r.setValue("multipart/form-data; boundary=\\(boundary)", forHTTPHeaderField: "Content-Type")
        r.httpBody = body + Data("--\\(boundary)--\\r\\n".utf8)
        return r
    }
}`,
    },
  ];
}

export const MOBILE_ALLOWED_ORIGINS = (c: SnippetContext) => ({ bridge: originOf(BRIDGE_URL), sdk: originOf(c.sdkUrl) });
