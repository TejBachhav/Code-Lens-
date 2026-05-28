from flask import Flask, jsonify, request

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok'})

@app.route('/api/items/<int:item_id>', methods=['GET', 'PUT', 'DELETE'])
def manage_item(item_id):
    if request.method == 'GET':
        return jsonify({'id': item_id})
    elif request.method == 'PUT':
        return jsonify(request.json), 200
    elif request.method == 'DELETE':
        return '', 204
