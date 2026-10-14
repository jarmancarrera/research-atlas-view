/* Password gate and in-memory decryption for the private Pages bundle. */
(function () {
  "use strict";

  var BUNDLE_URL = "./data/private.bundle.json";
  var ITERATIONS = 600000;
  var decrypted = null;
  var cryptoKey = null;
  var bundleSalt = null;
  var bundlePromise = null;
  var overlay;
  var form;
  var passwordInput;
  var submitButton;
  var message;
  var unlocked = false;
  var lockedStates = [];
  var resolveReady;
  var ready = new Promise(function(resolve){ resolveReady = resolve; });

  function element(tag, attributes, text) {
    var node = document.createElement(tag);
    Object.keys(attributes || {}).forEach(function (key) {
      if (key === "className") node.className = attributes[key];
      else if (key === "htmlFor") node.htmlFor = attributes[key];
      else node.setAttribute(key, attributes[key]);
    });
    if (text) node.textContent = text;
    return node;
  }

  function lockPage() {
    Array.prototype.forEach.call(document.body.children, function (child) {
      if (child !== overlay) {
        lockedStates.push({ node: child, inert: child.inert, ariaHidden: child.getAttribute("aria-hidden") });
        child.inert = true;
        child.setAttribute("aria-hidden", "true");
      }
    });
  }

  function buildGate() {
    var style = element("style", {});
    style.textContent = [
      ".emi-private-shade{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:rgba(20,39,59,.94);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172b40}",
      ".emi-private-card{box-sizing:border-box;width:min(100%,460px);padding:36px;background:#fbf8f1;border:1px solid rgba(255,255,255,.3);border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.3)}",
      ".emi-private-brand{margin:0 0 24px;color:#b31b1b;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}",
      ".emi-private-card h1{margin:0 0 10px;color:#14273b;font-family:Georgia,serif;font-size:clamp(28px,6vw,38px);font-weight:500;line-height:1.12}",
      ".emi-private-copy{margin:0 0 24px;color:#526172;font-size:15px;line-height:1.55}",
      ".emi-private-card label{display:block;margin:0 0 8px;color:#243a50;font-size:13px;font-weight:700}",
      ".emi-private-card input{box-sizing:border-box;width:100%;min-height:48px;padding:11px 13px;border:1px solid #aeb8bf;border-radius:8px;background:white;color:#14273b;font:inherit}",
      ".emi-private-card input:focus{outline:3px solid #e39797;outline-offset:2px}",
      ".emi-private-card button{width:100%;min-height:48px;margin-top:14px;border:0;border-radius:8px;background:#b31b1b;color:white;font:inherit;font-weight:700;cursor:pointer}",
      ".emi-private-card button:focus-visible{outline:3px solid #14273b;outline-offset:3px}",
      ".emi-private-card button:disabled{opacity:.65;cursor:wait}",
      ".emi-private-error{min-height:1.5em;margin:12px 0 0;color:#9b302b;font-size:14px;line-height:1.4}",
      ".emi-source-controls{display:grid;grid-template-columns:minmax(180px,2fr) minmax(150px,1fr);gap:8px 14px;align-items:center;margin:18px 0}",
      ".emi-source-controls label{font-size:13px;font-weight:700;color:#243a50}",
      ".emi-source-controls input,.emi-source-controls select{min-height:42px;padding:8px 10px;border:1px solid #aeb8bf;border-radius:7px;background:#fff;color:#14273b;font:inherit}",
      ".emi-source-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;align-items:center;padding:14px 0;border-bottom:1px solid #dce2e4}",
      ".emi-source-detail,.emi-source-status{color:#526172;font-size:13px}",
      ".emi-source-item .button{grid-column:2;grid-row:1/3}",
      ".emi-source-item button:focus-visible,.emi-source-controls input:focus-visible,.emi-source-controls select:focus-visible{outline:3px solid #e39797;outline-offset:2px}",
      "@media(max-width:640px){.emi-source-controls{grid-template-columns:1fr}.emi-source-item{grid-template-columns:1fr}.emi-source-item .button{grid-column:1;grid-row:auto}.emi-source-status{grid-column:1}}",
      "@media(prefers-reduced-motion:no-preference){.emi-private-card{animation:emi-private-in .2s ease-out}@keyframes emi-private-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}}"
    ].join("");
    document.head.appendChild(style);

    overlay = element("div", { className: "emi-private-shade" });
    overlay.id = "emiPrivateGate";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "emiPrivateTitle");
    overlay.setAttribute("aria-describedby", "emiPrivateCopy emiPrivateError");
    var card = element("section", { className: "emi-private-card" });
    card.appendChild(element("p", { className: "emi-private-brand" }, "Cornell EMI · Private research"));
    card.appendChild(element("h1", { id: "emiPrivateTitle" }, "Unlock the data room"));
    card.appendChild(element("p", { id: "emiPrivateCopy", className: "emi-private-copy" },
      "Enter the shared password to decrypt the private research package in this browser. Your password is not saved."));
    form = element("form", { novalidate: "" });
    var label = element("label", { htmlFor: "emiPrivatePassword" }, "Shared password");
    passwordInput = element("input", { id: "emiPrivatePassword", name: "password", type: "password",
      autocomplete: "off", required: "", autocapitalize: "off", spellcheck: "false" });
    submitButton = element("button", { type: "submit" }, "Unlock private data");
    message = element("p", { id: "emiPrivateError", className: "emi-private-error", role: "alert", "aria-live": "assertive" });
    form.appendChild(label);
    form.appendChild(passwordInput);
    form.appendChild(submitButton);
    form.appendChild(message);
    card.appendChild(form);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    lockPage();
    passwordInput.focus();

    overlay.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); return; }
      if (event.key !== "Tab") return;
      var focusable = [passwordInput, submitButton];
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault(); focusable[1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[1]) {
        event.preventDefault(); focusable[0].focus();
      }
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      unlock(passwordInput.value);
    });
  }

  function decodeBase64(value, label, expectedLength) {
    if (typeof value !== "string" || value.length % 4 !== 0 || /\s/.test(value)) {
      throw new Error("Private bundle has invalid " + label + ".");
    }
    var binary = atob(value);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (expectedLength && bytes.length !== expectedLength) throw new Error("Private bundle has invalid " + label + ".");
    return bytes;
  }

  function loadBundle() {
    if (!bundlePromise) {
      bundlePromise = fetch(BUNDLE_URL, { cache: "no-store", credentials: "same-origin" }).then(function (response) {
        if (!response.ok) throw new Error("Private data bundle is unavailable (HTTP " + response.status + ").");
        return response.json();
      }).then(function (envelope) {
        if (!envelope || envelope.version !== 1 || envelope.kdf !== "PBKDF2-SHA256" || envelope.iterations !== ITERATIONS) {
          throw new Error("Private data bundle uses an unsupported encryption format.");
        }
        var keys = Object.keys(envelope).sort().join(",");
        if (keys !== "ciphertext,iterations,iv,kdf,salt,version") {
          throw new Error("Private data bundle contains unsupported fields.");
        }
        var salt = decodeBase64(envelope.salt, "salt");
        var ciphertext = decodeBase64(envelope.ciphertext, "ciphertext");
        if (salt.length < 16 || ciphertext.length < 16) throw new Error("Private data bundle has invalid encryption parameters.");
        return {
          salt: salt,
          iv: decodeBase64(envelope.iv, "initialization vector", 12),
          ciphertext: ciphertext
        };
      }).catch(function (error) {
        bundlePromise = null;
        throw error;
      });
    }
    return bundlePromise;
  }

  function decrypt(password) {
    if (!window.crypto || !window.crypto.subtle || typeof TextEncoder !== "function") {
      return Promise.reject(new Error("This browser does not support secure private-data decryption."));
    }
    var derivedKey;
    var selectedSalt;
    return loadBundle().then(function (bundle) {
      selectedSalt = bundle.salt;
      return window.crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"])
        .then(function (material) {
          return window.crypto.subtle.deriveKey({ name: "PBKDF2", salt: bundle.salt, iterations: ITERATIONS, hash: "SHA-256" },
            material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
        }).then(function (key) {
          derivedKey = key;
          return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: bundle.iv, tagLength: 128 }, key, bundle.ciphertext);
        });
    }).then(function (plaintext) {
      var parsed;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)); }
      catch (error) { throw new Error("Decrypted private bundle is not valid UTF-8 JSON."); }
      if (!parsed || typeof parsed !== "object" || !parsed.current || typeof parsed.current !== "object" ||
          !parsed.snapshots || typeof parsed.snapshots !== "object" || Array.isArray(parsed.snapshots) ||
          !Array.isArray(parsed.assets)) {
        throw new Error("Decrypted private bundle is missing required data.");
      }
      cryptoKey = derivedKey;
      bundleSalt = selectedSalt;
      return parsed;
    });
  }

  function matchesSalt(encodedSalt) {
    var salt = decodeBase64(encodedSalt, "asset salt");
    if (!bundleSalt || salt.length !== bundleSalt.length) return false;
    for (var i = 0; i < salt.length; i += 1) if (salt[i] !== bundleSalt[i]) return false;
    return true;
  }

  function assetEnvelope(raw) {
    if (!raw || raw.version !== 1 || raw.kdf !== "PBKDF2-SHA256" || raw.iterations !== ITERATIONS ||
        Object.keys(raw).sort().join(",") !== "ciphertext,iterations,iv,kdf,salt,version" || !matchesSalt(raw.salt)) {
      throw new Error("Encrypted source has unsupported encryption parameters.");
    }
    var ciphertext = decodeBase64(raw.ciphertext, "asset ciphertext");
    if (ciphertext.length < 16) throw new Error("Encrypted source has invalid ciphertext.");
    return { iv: decodeBase64(raw.iv, "asset initialization vector", 12), ciphertext: ciphertext };
  }

  function safeFilename(label) {
    var base = String(label || "source.bin").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return base && base !== "." && base !== ".." ? base : "source.bin";
  }

  function hex(bytes) {
    return Array.prototype.map.call(new Uint8Array(bytes), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function verifyHeader(bytes, filename) {
    var name = filename.toLowerCase();
    var isPdf = bytes.length >= 5 && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45;
    var isZip = bytes.length >= 4 && bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4;
    if (/\.pdf$/.test(name) && !isPdf) throw new Error("Downloaded file does not have a PDF header.");
    if (/\.xlsx$/.test(name) && !isZip) throw new Error("Downloaded spreadsheet does not have an XLSX ZIP header.");
    if (isPdf) return "application/pdf";
    if (/\.xlsx$/.test(name)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (isZip) return "application/zip";
    return "application/octet-stream";
  }

  function downloadAsset(asset, statusNode, button) {
    if (!cryptoKey || !bundleSalt) return;
    if (typeof asset.encrypted_file !== "string" || !/^data\/assets\/[a-f0-9]{64}\.json$/.test(asset.encrypted_file)) {
      statusNode.textContent = "This source has an invalid encrypted-file reference.";
      return;
    }
    button.disabled = true;
    statusNode.textContent = "Decrypting source securely…";
    fetch("./" + asset.encrypted_file, { cache: "no-store", credentials: "same-origin" }).then(function (response) {
      if (!response.ok) throw new Error("Encrypted source is unavailable (HTTP " + response.status + ").");
      return response.json();
    }).then(function (raw) {
      var encrypted = assetEnvelope(raw);
      return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: encrypted.iv, tagLength: 128 }, cryptoKey, encrypted.ciphertext);
    }).then(function (plaintext) {
      var filename = safeFilename(asset.label);
      if (!/^[a-f0-9]{64}$/i.test(String(asset.sha256 || ""))) throw new Error("Source checksum is unavailable or invalid.");
      if (Number.isFinite(asset.bytes) && asset.bytes !== plaintext.byteLength) throw new Error("Source size verification failed.");
      return window.crypto.subtle.digest("SHA-256", plaintext).then(function (digest) {
        if (hex(digest) !== asset.sha256.toLowerCase()) throw new Error("Source checksum verification failed.");
        var bytes = new Uint8Array(plaintext);
        var type = verifyHeader(bytes, filename);
        var url = URL.createObjectURL(new Blob([bytes], { type: type }));
        var link = element("a", { href: url, download: filename, rel: "noopener" });
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        statusNode.textContent = "Source decrypted, checksum verified, and download started.";
      });
    }).catch(function (error) {
      statusNode.textContent = error && error.name === "OperationError"
        ? "Source authentication failed. No file was saved."
        : (error && error.message ? error.message : "Source could not be decrypted. No file was saved.");
    }).finally(function () { button.disabled = false; });
  }

  function renderSourceLibrary(assets) {
    var tab = document.getElementById("tab-sources");
    if (!tab || !Array.isArray(assets)) return;
    var panel = element("section", { className: "panel emi-source-library" });
    panel.setAttribute("aria-labelledby", "emiSourceLibraryTitle");
    var heading = element("div", { className: "panel-head" });
    var titleGroup = element("div", {});
    titleGroup.appendChild(element("h3", { id: "emiSourceLibraryTitle" }, "Available source library"));
    titleGroup.appendChild(element("p", { className: "panel-sub" },
      "Original source files in this private catalog. This library does not identify current feeds or the sources used in normalized charts."));
    heading.appendChild(titleGroup);
    panel.appendChild(heading);

    var controls = element("div", { className: "emi-source-controls" });
    var searchLabel = element("label", { htmlFor: "emiSourceSearch" }, "Search source files");
    var search = element("input", { id: "emiSourceSearch", type: "search", autocomplete: "off", placeholder: "Search label or group" });
    var groupLabel = element("label", { htmlFor: "emiSourceGroup" }, "Filter by group");
    var groupSelect = element("select", { id: "emiSourceGroup" });
    groupSelect.appendChild(element("option", { value: "" }, "All groups"));
    Array.from(new Set(assets.map(function (asset) { return String(asset.group || "Other"); }))).sort().forEach(function (group) {
      groupSelect.appendChild(element("option", { value: group }, group));
    });
    controls.appendChild(searchLabel);
    controls.appendChild(search);
    controls.appendChild(groupLabel);
    controls.appendChild(groupSelect);
    panel.appendChild(controls);
    var list = element("ul", { className: "record-list emi-source-list", "aria-label": "Available encrypted source files" });
    panel.appendChild(list);
    var empty = element("p", { className: "emi-source-empty", role: "status" }, "No source files match these filters.");
    empty.hidden = true;
    panel.appendChild(empty);
    tab.appendChild(panel);

    var rows = assets.map(function (asset) {
      var item = element("li", { className: "emi-source-item" });
      var title = element("strong", {}, String(asset.label || "Unlabeled source"));
      var group = String(asset.group || "Other");
      var size = Number.isFinite(asset.bytes) ? Number(asset.bytes).toLocaleString() + " bytes" : "Size unavailable";
      var detail = element("span", { className: "emi-source-detail" }, group + " · " + size);
      var status = element("span", { className: "emi-source-status", role: "status", "aria-live": "polite" });
      var button = element("button", { type: "button", className: "button secondary" }, "Download source");
      button.addEventListener("click", function () { downloadAsset(asset, status, button); });
      item.appendChild(title);
      item.appendChild(detail);
      item.appendChild(button);
      item.appendChild(status);
      item.dataset.search = (String(asset.label || "") + " " + group).toLowerCase();
      item.dataset.group = group;
      return item;
    });
    function filter() {
      var term = search.value.trim().toLowerCase();
      var selected = groupSelect.value;
      rows.forEach(function (row) {
        row.hidden = (term && row.dataset.search.indexOf(term) < 0) || (selected && row.dataset.group !== selected);
      });
      empty.hidden = rows.some(function (row) { return !row.hidden; });
    }
    search.addEventListener("input", filter);
    groupSelect.addEventListener("change", filter);
    rows.forEach(function (row) { list.appendChild(row); });
  }

  function unlock(password) {
    message.textContent = "";
    if (!password) {
      message.textContent = "Enter the shared password to continue.";
      passwordInput.focus();
      return;
    }
    submitButton.disabled = true;
    passwordInput.disabled = true;
    submitButton.textContent = "Decrypting securely…";
    decrypt(password).then(function (packageData) {
      decrypted = packageData;
      unlocked = true;
      renderSourceLibrary(packageData.assets);
      resolveReady();
      passwordInput.value = "";
      overlay.remove();
      lockedStates.forEach(function (state) {
        state.node.inert = state.inert;
        if (state.ariaHidden == null) state.node.removeAttribute("aria-hidden");
        else state.node.setAttribute("aria-hidden", state.ariaHidden);
      });
    }).catch(function (error) {
      message.textContent = error && error.name === "OperationError"
        ? "Password is incorrect, or the encrypted package failed authentication. Check the password and try again."
        : (error && error.message ? error.message : "Private data could not be decrypted. Access remains locked.");
      passwordInput.value = "";
      passwordInput.disabled = false;
      submitButton.disabled = false;
      submitButton.textContent = "Unlock private data";
      passwordInput.focus();
    });
  }

  var api = {
    load: async function (snapshotId) {
      await ready;
      var requested = snapshotId == null || snapshotId === "current" ? decrypted.current : decrypted.snapshots[snapshotId];
      if (!requested && decrypted.current.snapshot_id === snapshotId) requested = decrypted.current;
      if (!requested || typeof requested !== "object") {
        return Promise.reject(new Error("The requested private snapshot is unavailable in this bundle."));
      }
      return Promise.resolve(requested);
    }
  };
  Object.defineProperty(api, "isUnlocked", { enumerable: true, get: function () { return unlocked; } });
  window.EMIData = api;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildGate, { once: true });
  else buildGate();
}());
