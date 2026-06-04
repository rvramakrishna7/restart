const positionManager = require("../../managers/positionManagerInstance");

exports.getLivePositions = (req, res) => {
  try {
    const positions = positionManager.getPositions();

    res.json({
      success: true,
      data: positions
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};