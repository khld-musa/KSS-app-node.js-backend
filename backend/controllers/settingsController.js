const Settings = require('../models/settings');

// The single settings document, created with defaults the first time it is needed
function loadSettings() {
  return Settings.findOneAndUpdate(
    { key: 'app' },
    { $setOnInsert: { key: 'app' } },
    { upsert: true, returnDocument: 'after' }
  );
}

// GET /settings
exports.getSettings = async (req, res) => {
  res.json({ success: true, settings: await loadSettings() });
};

// PATCH /admin/settings
exports.updateSettings = async (req, res) => {
  const settings = await loadSettings();
  settings.set(req.body);
  await settings.save();
  res.json({ success: true, settings });
};
