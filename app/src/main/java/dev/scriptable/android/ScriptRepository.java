package dev.scriptable.android;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.KeyStore;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** The app's private durable store. No script can address arbitrary Android paths. */
final class ScriptRepository {
    static final Object STORAGE_LOCK = new Object();
    static final int MAX_BYTES = 16 * 1024 * 1024;
    static final int MAX_SCRIPT_BYTES = 1024 * 1024;
    private static final String KEY_ALIAS = "scriptable.private.keychain.v1";
    private final Context context;
    private final File root;
    private JSONArray scripts;

    ScriptRepository(Context context) throws Exception {
        this.context = context.getApplicationContext();
        root = new File(context.getFilesDir(), "script-files");
        synchronized (STORAGE_LOCK) {
            for (String name : new String[]{"documents", "cache", "temporary", "library", "cloud", "bookmarks"}) {
                File dir = new File(root, name);
                if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("Cannot create private storage");
            }
        }
        File scriptFile = new File(context.getFilesDir(), "scripts.json");
        if (scriptFile.isFile()) scripts = new JSONArray(new String(readFile(scriptFile, MAX_BYTES), StandardCharsets.UTF_8));
        else {
            try (InputStream stream = context.getAssets().open("examples.json")) {
                JSONArray examples = new JSONArray(new String(readStream(stream, MAX_BYTES), StandardCharsets.UTF_8));
                scripts = new JSONArray();
                for (int i = 0; i < Math.min(4, examples.length()); i++) scripts.put(examples.getJSONObject(i));
            } catch (Exception ignored) { scripts = new JSONArray(); }
            for (int i = 0; i < scripts.length(); i++) {
                JSONObject script = scripts.getJSONObject(i);
                if (!script.has("id")) script.put("id", UUID.randomUUID().toString());
                if (!script.has("updatedAt")) script.put("updatedAt", System.currentTimeMillis());
                if (!script.has("color")) script.put("color", "#4C7CF3");
                if (!script.has("icon")) script.put("icon", "code");
            }
            persistScripts();
        }
    }

    JSONArray list() throws Exception { synchronized(STORAGE_LOCK){reloadScripts();return new JSONArray(scripts.toString());} }
    private void reloadScripts() throws Exception {File file=new File(context.getFilesDir(),"scripts.json");if(file.isFile())scripts=new JSONArray(new String(readFile(file,MAX_BYTES),StandardCharsets.UTF_8));}

    JSONObject find(String id) throws Exception { synchronized(STORAGE_LOCK){reloadScripts();return findLocked(id);} }
    private JSONObject findLocked(String id) throws Exception {
        for (int i = 0; i < scripts.length(); i++) {
            JSONObject script = scripts.getJSONObject(i);
            if (id.equals(script.optString("id"))) return new JSONObject(script.toString());
        }
        throw new Exception("Script was not found");
    }

    JSONObject save(JSONObject payload) throws Exception { synchronized(STORAGE_LOCK){reloadScripts();return saveLocked(payload);} }
    private JSONObject saveLocked(JSONObject payload) throws Exception {
        String name = payload.optString("name", "Untitled").trim();
        String code = payload.optString("code", "");
        if (name.length() == 0 || name.length() > 120) throw new Exception("Script name must contain 1–120 characters");
        if (code.getBytes(StandardCharsets.UTF_8).length > MAX_SCRIPT_BYTES) throw new Exception("Script exceeds the 1 MB limit");
        String id = payload.optString("id", "");
        if (id.isEmpty()) id = UUID.randomUUID().toString();
        if (!id.matches("[A-Za-z0-9_-]{1,80}")) throw new Exception("Invalid script ID");
        JSONObject script = new JSONObject().put("id", id).put("name", name).put("code", code)
                .put("color", payload.optString("color", "#4C7CF3")).put("icon", payload.optString("icon", "code"))
                .put("updatedAt", System.currentTimeMillis());
        JSONArray next = new JSONArray();
        boolean replaced = false;
        for (int i = 0; i < scripts.length(); i++) {
            JSONObject current = scripts.getJSONObject(i);
            if (id.equals(current.optString("id"))) { next.put(script); replaced = true; }
            else next.put(current);
        }
        if (!replaced) next.put(script);
        if (next.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new Exception("Script library exceeds the 16 MB limit; export or remove scripts first");
        atomicWrite(new File(context.getFilesDir(), "scripts.json"), next.toString().getBytes(StandardCharsets.UTF_8));
        scripts = next;
        return new JSONObject(script.toString());
    }

    boolean delete(String id) throws Exception { synchronized(STORAGE_LOCK){reloadScripts();return deleteLocked(id);} }
    private boolean deleteLocked(String id) throws Exception {
        JSONArray next = new JSONArray();
        boolean deleted = false;
        for (int i = 0; i < scripts.length(); i++) {
            JSONObject script = scripts.getJSONObject(i);
            if (id.equals(script.optString("id"))) deleted = true;
            else next.put(script);
        }
        atomicWrite(new File(context.getFilesDir(), "scripts.json"), next.toString().getBytes(StandardCharsets.UTF_8));
        scripts = next;
        return deleted;
    }

    private void persistScripts() throws Exception {
        atomicWrite(new File(context.getFilesDir(), "scripts.json"), scripts.toString().getBytes(StandardCharsets.UTF_8));
    }

    synchronized JSONObject settings() throws Exception {
        return new JSONObject(context.getSharedPreferences("settings", Context.MODE_PRIVATE).getString("json", "{}"));
    }

    synchronized JSONObject setSettings(JSONObject payload) throws Exception {
        JSONObject result = settings();
        for (java.util.Iterator<String> iterator = payload.keys(); iterator.hasNext();) {
            String key = iterator.next();
            result.put(key, payload.get(key));
        }
        if (result.toString().length() > 16384) throw new Exception("Settings exceed the storage limit");
        if (!context.getSharedPreferences("settings", Context.MODE_PRIVATE).edit().putString("json", result.toString()).commit())
            throw new Exception("Settings could not be saved");
        return result;
    }

    private File resolve(String path) throws Exception {
        if (path == null || path.length() > 1024 || !path.matches("^/(documents|cache|temporary|library|cloud|bookmarks)(/.*)?$") || path.indexOf('\0') >= 0)
            throw new Exception("Paths must be inside /documents, /cache, /temporary or /library");
        File candidate = new File(root, path.substring(1)).getCanonicalFile();
        File allowedRoot = new File(root, path.split("/", 3)[1]).getCanonicalFile();
        if (!candidate.equals(allowedRoot) && !candidate.getPath().startsWith(allowedRoot.getPath() + File.separator))
            throw new Exception("Path escapes its private storage directory");
        return candidate;
    }

    JSONObject fileSnapshot() throws Exception { synchronized (STORAGE_LOCK) { return fileSnapshotLocked(); } }

    private JSONObject fileSnapshotLocked() throws Exception {
        JSONObject snapshot = new JSONObject();
        JSONObject metadata = metadata();
        int[] budget = {MAX_BYTES};
        int[] count = {0};
        for (String dir : new String[]{"documents", "cache", "temporary", "library", "cloud", "bookmarks"}) snapshotDirectory(new File(root, dir), "/" + dir, snapshot, budget, count, metadata);
        if (snapshot.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new Exception("File snapshot exceeds the 16 MB limit");
        return snapshot;
    }

    private void snapshotDirectory(File directory, String path, JSONObject result, int[] budget, int[] count, JSONObject metadata) throws Exception {
        snapshotDirectorySkipping(directory, path, result, budget, count, metadata, null);
    }

    private void snapshotDirectorySkipping(File directory, String path, JSONObject result, int[] budget, int[] count, JSONObject metadata, String excluded) throws Exception {
        if (path.equals(excluded)) return;
        if (++count[0] > 2048) throw new Exception("Private storage contains too many items (maximum 2048)");
        result.put(path, new JSONObject().put("type", "directory").put("modifiedAt", directory.lastModified()).put("createdAt", creationTime(directory, path, metadata)));
        File[] children = directory.listFiles();
        if (children == null) return;
        for (File child : children) {
            String childPath = path + "/" + child.getName();
            resolve(childPath);
            if (child.isDirectory()) snapshotDirectorySkipping(child, childPath, result, budget, count, metadata, excluded);
            else if (child.isFile()) {
                if (childPath.equals(excluded)) continue;
                if (++count[0] > 2048) throw new Exception("Private storage contains too many items (maximum 2048)");
                byte[] bytes = readFile(child, budget[0]);
                budget[0] -= bytes.length;
                result.put(childPath, snapshotFile(bytes, child.lastModified()).put("createdAt", creationTime(child, childPath, metadata)));
            }
        }
    }

    Object fileOperation(JSONObject payload) throws Exception { synchronized (STORAGE_LOCK) { return fileOperationLocked(payload); } }

    private Object fileOperationLocked(JSONObject payload) throws Exception {
        String operation = payload.getString("op");
        File source = resolve(payload.getString("path"));
        boolean isRoot = source.getParentFile().getCanonicalFile().equals(root.getCanonicalFile());
        switch (operation) {
            case "writeString": case "write": {
                if (isRoot) throw new Exception("Cannot overwrite a storage directory");
                if (source.isDirectory()) throw new Exception("Cannot overwrite a directory with a file");
                byte[] data = operation.equals("writeString") ? payload.optString("text", "").getBytes(StandardCharsets.UTF_8)
                        : Base64.decode(payload.optString("base64", ""), Base64.DEFAULT);
                if (data.length > MAX_BYTES) throw new Exception("File exceeds the 16 MB limit");
                ensureCapacity(source, data.length);
                ensureSnapshotMutation(operation, source, null, data);
                long createdAt = source.exists() ? creationTime(source, virtualPath(source), metadata()) : System.currentTimeMillis();
                atomicWrite(source, data);
                JSONObject metadata = metadata(); JSONObject item = metadata.getJSONObject("files").optJSONObject(virtualPath(source));
                if (item == null) item = new JSONObject().put("tags", new JSONArray()).put("attributes", new JSONObject());
                item.put("createdAt", createdAt); metadata.getJSONObject("files").put(virtualPath(source), item); persistMetadata(metadata);
                return new JSONObject().put("modifiedAt", source.lastModified());
            }
            case "createDirectory":
                if (source.exists() && !source.isDirectory()) throw new Exception("A file already exists at this path");
                ensureSnapshotMutation(operation, source, null, null);
                if (!source.isDirectory() && !source.mkdirs()) throw new Exception("Directory could not be created");
                return true;
            case "remove":
                if (isRoot) throw new Exception("Cannot remove a storage directory");
                removeTree(source);
                return true;
            case "move": case "copy": {
                File destination = resolve(payload.getString("destination"));
                if (isRoot || destination.getParentFile().getCanonicalFile().equals(root.getCanonicalFile())) throw new Exception("Cannot replace a storage directory");
                if (!source.exists()) throw new Exception("Source does not exist");
                if (destination.exists()) throw new Exception("Destination already exists");
                if (source.equals(destination) || destination.getPath().startsWith(source.getPath() + File.separator)) throw new Exception("Destination must be outside the source");
                ensureSnapshotMutation(operation, source, destination, null);
                if (operation.equals("copy")) {
                    ensureCapacity(destination, treeSize(source));
                    copyTree(source, destination);
                } else {
                    File parent = destination.getParentFile();
                    if (!parent.isDirectory() && !parent.mkdirs()) throw new Exception("Cannot create destination directory");
                    Files.move(source.toPath(), destination.toPath());
                }
                return true;
            }
            default: throw new Exception("Unsupported file operation: " + operation);
        }
    }

    private boolean isScriptMirror(String path) throws Exception {
        if(!path.startsWith("/documents/")||path.substring(11).contains("/")||!path.endsWith(".js"))return false;
        reloadScripts();String name=path.substring(11,path.length()-3);for(int i=0;i<scripts.length();i++)if(name.equals(scripts.getJSONObject(i).optString("name")))return true;return false;
    }
    private String virtualPath(File file) throws Exception {
        return "/" + root.getCanonicalFile().toPath().relativize(file.getCanonicalFile().toPath()).toString().replace(File.separatorChar, '/');
    }

    JSONObject metadata() throws Exception { synchronized (STORAGE_LOCK) { return metadataLocked(); } }

    private JSONObject metadataLocked() throws Exception {
        JSONObject value = new JSONObject(context.getSharedPreferences("file-metadata", Context.MODE_PRIVATE).getString("json", "{}"));
        if (value.optJSONObject("files") == null) value.put("files", new JSONObject());
        if (value.optJSONObject("bookmarks") == null) value.put("bookmarks", new JSONObject());
        return value;
    }

    private void persistMetadata(JSONObject value) throws Exception {
        String json = value.toString();
        if (json.getBytes(StandardCharsets.UTF_8).length > 128 * 1024) throw new Exception("File metadata exceeds the 128 KB limit");
        if (!context.getSharedPreferences("file-metadata", Context.MODE_PRIVATE).edit().putString("json", json).commit()) throw new Exception("File metadata could not be saved");
    }

    Object metadataOperation(JSONObject payload) throws Exception { synchronized (STORAGE_LOCK) { return metadataOperationLocked(payload); } }

    private Object metadataOperationLocked(JSONObject payload) throws Exception {
        JSONObject value = metadata(); String op = payload.getString("op");
        if ("removeBookmark".equals(op)) { value.getJSONObject("bookmarks").remove(payload.getString("name")); persistMetadata(value); return true; }
        File file = resolve(payload.getString("path")); if (!file.exists() && !isScriptMirror(payload.getString("path"))) throw new Exception("File does not exist"); String path = virtualPath(file);
        if ("bookmark".equals(op)) {
            String name = payload.getString("name"); if (name.isEmpty() || name.length() > 80 || name.contains("/") || name.contains("\\") || name.equals(".") || name.equals("..")) throw new Exception("Invalid bookmark name");
            value.getJSONObject("bookmarks").put(name, path);
        } else {
            JSONObject item = value.getJSONObject("files").optJSONObject(path); if (item == null) item = new JSONObject().put("tags", new JSONArray()).put("attributes", new JSONObject()).put("createdAt", creationTime(file, path, value));
            JSONArray tags = item.optJSONArray("tags"); if (tags == null) tags = new JSONArray(); JSONObject attributes = item.optJSONObject("attributes"); if (attributes == null) attributes = new JSONObject();
            switch (op) {
                case "addTag": case "removeTag": {
                    String tag = payload.getString("tag"); if (tag.length() > 128) throw new Exception("Tag exceeds 128 characters"); JSONArray next = new JSONArray(); boolean exists = false;
                    for (int i = 0; i < tags.length(); i++) { String current = tags.getString(i); if (current.equals(tag)) exists = true; if (!"removeTag".equals(op) || !current.equals(tag)) next.put(current); }
                    if ("addTag".equals(op) && !exists) next.put(tag); item.put("tags", next); break;
                }
                case "writeAttribute": case "removeAttribute": {
                    String name = payload.getString("name"); if (name.isEmpty() || name.length() > 200) throw new Exception("Invalid attribute name");
                    if ("removeAttribute".equals(op)) attributes.remove(name); else { String content = payload.getString("value"); if (content.getBytes(StandardCharsets.UTF_8).length > 16384) throw new Exception("Attribute exceeds 16 KB"); attributes.put(name, content); }
                    item.put("attributes", attributes); break;
                }
                default: throw new Exception("Unsupported file metadata operation: " + op);
            }
            value.getJSONObject("files").put(path, item);
        }
        persistMetadata(value); return true;
    }

    private long creationTime(File file, String path, JSONObject metadata) {
        JSONObject item = metadata.optJSONObject("files") == null ? null : metadata.optJSONObject("files").optJSONObject(path);
        long persisted = item == null ? 0 : item.optLong("createdAt", 0); if (persisted > 0) return persisted;
        try { long created = Files.readAttributes(file.toPath(), java.nio.file.attribute.BasicFileAttributes.class).creationTime().toMillis(); if (created > 0) return created; } catch (Exception ignored) { }
        return Math.max(0, file.lastModified());
    }

    /** Validate the entire future cache before an atomic replacement of one linked provider folder. */
    void replaceFolderFromStaging(File stage, String virtualPath) throws Exception {
        synchronized (STORAGE_LOCK) {
            if (virtualPath == null || !(virtualPath.equals("/cloud") || virtualPath.matches("/bookmarks/[^/\\\\]{1,80}"))) throw new Exception("Only a linked cloud or bookmark folder can be replaced");
            String alias = virtualPath.substring(virtualPath.lastIndexOf('/') + 1);
            if (alias.equals(".") || alias.equals("..") || virtualPath.indexOf('\0') >= 0) throw new Exception("Invalid cloud folder path");
            File cacheRoot = context.getCacheDir().getCanonicalFile(), staged = stage.getCanonicalFile(), target = resolve(virtualPath);
            if (!target.getPath().startsWith(root.getCanonicalPath() + File.separator) || Files.isSymbolicLink(new File(root, virtualPath.substring(1)).toPath())) throw new Exception("Linked folder target must remain inside private file storage");
            if (!staged.isDirectory() || !staged.getPath().startsWith(cacheRoot.getPath() + File.separator) || Files.isSymbolicLink(stage.toPath())) throw new Exception("Staging must be a private cache directory");
            verifyStagedTree(staged, staged, new int[]{0}, 0);
            JSONObject prospective = new JSONObject(), metadata = metadataLocked(); int[] budget = {MAX_BYTES}, count = {0};
            for (String dir : new String[]{"documents", "cache", "temporary", "library", "cloud", "bookmarks"}) snapshotDirectorySkipping(new File(root, dir), "/" + dir, prospective, budget, count, metadata, virtualPath);
            snapshotDirectory(staged, virtualPath, prospective, budget, count, metadata);
            if (prospective.length() > 2048 || prospective.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES - 16384) throw new Exception("The linked folder would exceed the private file snapshot limit");
            File parent = target.getParentFile(); if (!parent.isDirectory() && !parent.mkdirs()) throw new Exception("Cannot create linked folder parent");
            File backup = new File(cacheRoot, "scriptable-folder-backup-" + UUID.randomUUID());
            boolean backedUp = false;
            try {
                if (target.exists()) { Files.move(target.toPath(), backup.toPath(), StandardCopyOption.ATOMIC_MOVE); backedUp = true; }
                Files.move(staged.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception failure) {
                if (backedUp) {
                    try { if (target.exists()) removeBoundedTree(target, target.getCanonicalFile()); Files.move(backup.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE); }
                    catch (Exception restore) { failure.addSuppressed(restore); throw new Exception("Cloud folder replacement failed; the original is retained in private cache at " + backup.getName(), failure); }
                }
                throw failure;
            }
            if (backedUp) { try { removeBoundedTree(backup, backup.getCanonicalFile()); } catch (Exception ignored) { /* The validated private-cache backup can be reclaimed by Android. */ } }
        }
    }

    private void verifyStagedTree(File current, File allowed, int[] count, int depth) throws Exception {
        if (depth > 20 || ++count[0] > 2048 || Files.isSymbolicLink(current.toPath())) throw new Exception("Staged folder contains too many entries, excessive depth or a symbolic link");
        File resolved = current.getCanonicalFile(); if (!resolved.equals(allowed) && !resolved.getPath().startsWith(allowed.getPath() + File.separator)) throw new Exception("Staged entry escapes its private cache directory");
        if (current.isDirectory()) { File[] children = current.listFiles(); if (children == null) throw new Exception("Staged folder cannot be read"); for (File child : children) verifyStagedTree(child, allowed, count, depth + 1); }
        else if (!current.isFile()) throw new Exception("Unsupported staged file type");
    }

    private void removeBoundedTree(File current, File allowed) throws Exception {
        if (Files.isSymbolicLink(current.toPath())) { Files.deleteIfExists(current.toPath()); return; }
        File resolved = current.getCanonicalFile(); if (!resolved.equals(allowed) && !resolved.getPath().startsWith(allowed.getPath() + File.separator)) throw new Exception("Cleanup target escapes its verified private directory");
        File[] children = current.isDirectory() ? current.listFiles() : null; if (children != null) for (File child : children) removeBoundedTree(child, allowed);
        Files.deleteIfExists(current.toPath());
    }

    /** Check the serialized bootstrap size before changing disk, including escaping and base64 expansion. */
    private void ensureSnapshotMutation(String operation, File source, File destination, byte[] bytes) throws Exception {
        JSONObject candidate = fileSnapshot();
        String sourcePath = virtualPath(source);
        if ("write".equals(operation) || "writeString".equals(operation)) {
            addParentEntries(candidate, sourcePath);
            candidate.put(sourcePath, snapshotFile(bytes, System.currentTimeMillis()));
        } else if ("createDirectory".equals(operation)) {
            addParentEntries(candidate, sourcePath + "/item");
        } else {
            String destinationPath = virtualPath(destination);
            addParentEntries(candidate, destinationPath);
            java.util.ArrayList<String> originals = new java.util.ArrayList<>();
            for (java.util.Iterator<String> iterator = candidate.keys(); iterator.hasNext();) {
                String path = iterator.next();
                if (path.equals(sourcePath) || path.startsWith(sourcePath + "/")) originals.add(path);
            }
            for (String path : originals) candidate.put(destinationPath + path.substring(sourcePath.length()), candidate.get(path));
            if ("move".equals(operation)) for (String path : originals) candidate.remove(path);
        }
        if (candidate.length() > 2048) throw new Exception("Private storage supports at most 2048 items");
        if (candidate.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES - 16384)
            throw new Exception("File snapshot would exceed the 16 MB limit; remove unused files first");
    }

    private void addParentEntries(JSONObject candidate, String path) throws Exception {
        String[] components = path.split("/");
        String current = "";
        for (int i = 1; i < components.length - 1; i++) {
            current += "/" + components[i];
            if (candidate.has(current)) {
                if (!"directory".equals(candidate.getJSONObject(current).optString("type"))) throw new Exception("Parent path is a file");
            } else candidate.put(current, new JSONObject().put("type", "directory").put("modifiedAt", System.currentTimeMillis()));
        }
    }

    private JSONObject snapshotFile(byte[] bytes, long modifiedAt) throws Exception {
        JSONObject result = new JSONObject().put("type", "file").put("modifiedAt", modifiedAt);
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();
            if (text.indexOf('\0') < 0) return result.put("text", text);
        } catch (java.nio.charset.CharacterCodingException ignored) { }
        return result.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
    }

    private void ensureCapacity(File replacement, long length) throws Exception {
        if (treeSize(root) - (replacement.exists() ? treeSize(replacement) : 0) + length > MAX_BYTES)
            throw new Exception("Private file storage exceeds the 16 MB limit");
    }

    private long treeSize(File file) throws Exception {
        if (file.isFile()) return file.length();
        long size = 0;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) { size += treeSize(child); if (size > MAX_BYTES) break; }
        return size;
    }

    private void copyTree(File source, File destination) throws Exception {
        if (source.isDirectory()) {
            if (!destination.mkdirs()) throw new Exception("Cannot create directory");
            File[] children = source.listFiles();
            if (children != null) for (File child : children) copyTree(child, new File(destination, child.getName()));
        } else atomicWrite(destination, readFile(source, MAX_BYTES));
    }

    private void removeTree(File file) throws Exception {
        File[] children = file.isDirectory() ? file.listFiles() : null;
        if (children != null) for (File child : children) removeTree(child);
        if (file.exists() && !file.delete()) throw new Exception("Could not remove file");
    }

    JSONObject keychainSnapshot() throws Exception { synchronized (STORAGE_LOCK) { return keychainSnapshotLocked(); } }

    private JSONObject keychainSnapshotLocked() throws Exception {
        JSONObject result = new JSONObject();
        java.util.Map<String, ?> values = context.getSharedPreferences("keychain", Context.MODE_PRIVATE).getAll();
        for (String key : values.keySet()) {
            Object encrypted = values.get(key);
            if (encrypted instanceof String) result.put(key, decrypt((String) encrypted));
        }
        return result;
    }

    Object keychainOperation(JSONObject payload) throws Exception { synchronized (STORAGE_LOCK) { return keychainOperationLocked(payload); } }

    private Object keychainOperationLocked(JSONObject payload) throws Exception {
        String key = payload.getString("key");
        if (key.isEmpty() || key.length() > 200) throw new Exception("Key must contain 1–200 characters");
        android.content.SharedPreferences preferences = context.getSharedPreferences("keychain", Context.MODE_PRIVATE);
        if ("remove".equals(payload.getString("op"))) {
            if (!preferences.edit().remove(key).commit()) throw new Exception("Key could not be removed");
        } else if ("set".equals(payload.getString("op"))) {
            String value = payload.getString("value");
            if (value.getBytes(StandardCharsets.UTF_8).length > 16384 || (!preferences.contains(key) && preferences.getAll().size() >= 256))
                throw new Exception("Keychain storage limit exceeded");
            if (!preferences.edit().putString(key, encrypt(value)).commit()) throw new Exception("Key could not be saved");
        } else throw new Exception("Unsupported keychain operation");
        return true;
    }

    private SecretKey secretKey() throws Exception {
        synchronized (STORAGE_LOCK) { return secretKeyLocked(); }
    }

    private SecretKey secretKeyLocked() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private String decrypt(String encrypted) throws Exception {
        String[] parts = encrypted.split(":", 2);
        if (parts.length != 2) throw new Exception("Keychain value is corrupt");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    static byte[] readStream(InputStream stream, int limit) throws Exception {
        if (limit < 0) throw new Exception("Storage limit exceeded");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = stream.read(buffer)) != -1) {
            if (output.size() + count > limit) throw new Exception("Data exceeds the " + (limit / 1024) + " KB limit");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static byte[] readFile(File file, int limit) throws Exception {
        try (InputStream stream = new FileInputStream(file)) { return readStream(stream, limit); }
    }

    static void atomicWrite(File destination, byte[] bytes) throws Exception {
        File parent = destination.getParentFile();
        if (!parent.isDirectory() && !parent.mkdirs()) throw new Exception("Could not create parent directory");
        File temporary = File.createTempFile(".write-", ".tmp", parent);
        try {
            try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(bytes); output.getFD().sync(); }
            Files.move(temporary.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } finally { if (temporary.exists()) temporary.delete(); }
    }
}
