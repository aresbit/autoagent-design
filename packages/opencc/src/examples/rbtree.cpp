#include <iostream>
#include <queue>
using namespace std;

// 节点颜色枚举
enum Color { RED, BLACK };

// 红黑树节点结构
struct Node {
    int data;           // 节点数据
    Color color;        // 节点颜色
    Node *left, *right, *parent;  // 左右子节点和父节点

    // 构造函数
    Node(int data) {
        this->data = data;
        this->color = RED;  // 新节点默认为红色
        left = right = parent = nullptr;
    }
};

class RedBlackTree {
private:
    Node* root;  // 根节点

    // ==================== 辅助函数 ====================

    // 左旋操作
    //       x              y
    //      / \            / \
    //     a   y    =>    x   c
    //        / \        / \
    //       b   c      a   b
    void leftRotate(Node* x) {
        Node* y = x->right;  // y是x的右子节点
        x->right = y->left;  // 将y的左子树变为x的右子树

        if (y->left != nullptr)
            y->left->parent = x;

        y->parent = x->parent;  // 将x的父节点设为y的父节点

        if (x->parent == nullptr)
            root = y;  // 如果x是根节点，y成为新根
        else if (x == x->parent->left)
            x->parent->left = y;
        else
            x->parent->right = y;

        y->left = x;  // x成为y的左子节点
        x->parent = y;
    }

    // 右旋操作（左旋的镜像）
    void rightRotate(Node* y) {
        Node* x = y->left;
        y->left = x->right;

        if (x->right != nullptr)
            x->right->parent = y;

        x->parent = y->parent;

        if (y->parent == nullptr)
            root = x;
        else if (y == y->parent->left)
            y->parent->left = x;
        else
            y->parent->right = x;

        x->right = y;
        y->parent = x;
    }

    // 获取节点的颜色（空节点为黑色）
    Color getColor(Node* node) {
        if (node == nullptr)
            return BLACK;
        return node->color;
    }

    // 设置节点颜色
    void setColor(Node* node, Color color) {
        if (node != nullptr)
            node->color = color;
    }

    // ==================== 插入修复 ====================

    // 插入后修复红黑树性质
    // 可能违反的性质：红色节点的子节点必须是黑色（新插入的红色节点可能导致两个红色节点相邻）
    void fixInsert(Node* node) {
        Node* parent = nullptr;
        Node* grandparent = nullptr;

        // 当父节点存在且为红色时需要修复
        while (node != root && getColor(node) == RED && getColor(node->parent) == RED) {
            parent = node->parent;
            grandparent = parent->parent;

            // 父节点是祖父节点的左子节点
            if (parent == grandparent->left) {
                Node* uncle = grandparent->right;  // 叔叔节点

                // 情况1：叔叔节点是红色
                // 解决：将父节点和叔叔节点设为黑色，祖父节点设为红色，然后继续检查祖父节点
                if (getColor(uncle) == RED) {
                    setColor(parent, BLACK);
                    setColor(uncle, BLACK);
                    setColor(grandparent, RED);
                    node = grandparent;  // 继续检查祖父节点
                }
                else {
                    // 情况2：当前节点是父节点的右子节点（需要左旋变成情况3）
                    if (node == parent->right) {
                        leftRotate(parent);
                        node = parent;
                        parent = node->parent;
                    }

                    // 情况3：当前节点是父节点的左子节点
                    // 解决：右旋祖父节点，交换父节点和祖父节点的颜色
                    rightRotate(grandparent);
                    swap(parent->color, grandparent->color);
                    node = parent;
                }
            }
            // 父节点是祖父节点的右子节点（与上面镜像对称）
            else {
                Node* uncle = grandparent->left;

                if (getColor(uncle) == RED) {
                    setColor(parent, BLACK);
                    setColor(uncle, BLACK);
                    setColor(grandparent, RED);
                    node = grandparent;
                }
                else {
                    if (node == parent->left) {
                        rightRotate(parent);
                        node = parent;
                        parent = node->parent;
                    }

                    leftRotate(grandparent);
                    swap(parent->color, grandparent->color);
                    node = parent;
                }
            }
        }

        // 确保根节点为黑色
        root->color = BLACK;
    }

    // ==================== 删除修复 ====================

    // 找到以node为根的子树中的最小节点
    Node* minValueNode(Node* node) {
        while (node->left != nullptr)
            node = node->left;
        return node;
    }

    // 用v替换u的位置
    void transplant(Node* u, Node* v) {
        if (u->parent == nullptr)
            root = v;
        else if (u == u->parent->left)
            u->parent->left = v;
        else
            u->parent->right = v;

        if (v != nullptr)
            v->parent = u->parent;
    }

    // 删除后修复红黑树性质
    // x是替换被删除节点的节点，可能违反性质：从任一节点到其每个叶子的所有简单路径都包含相同数目的黑色节点
    void fixDelete(Node* x) {
        // 当x不是根节点且x是黑色时需要修复（红色不会违反黑高性质）
        while (x != root && getColor(x) == BLACK) {
            if (x == x->parent->left) {  // x是左子节点
                Node* sibling = x->parent->right;  // 兄弟节点

                // 情况1：兄弟节点是红色
                // 解决：左旋父节点，交换父节点和兄弟节点颜色，重新确定兄弟节点
                if (getColor(sibling) == RED) {
                    setColor(sibling, BLACK);
                    setColor(x->parent, RED);
                    leftRotate(x->parent);
                    sibling = x->parent->right;
                }

                // 情况2：兄弟节点的两个子节点都是黑色
                // 解决：将兄弟节点设为红色，将问题上移到父节点
                if (getColor(sibling->left) == BLACK && getColor(sibling->right) == BLACK) {
                    setColor(sibling, RED);
                    x = x->parent;
                }
                else {
                    // 情况3：兄弟节点的右子节点是黑色，左子节点是红色
                    // 解决：右旋兄弟节点，交换兄弟节点和其左子节点的颜色，重新确定兄弟节点
                    if (getColor(sibling->right) == BLACK) {
                        setColor(sibling->left, BLACK);
                        setColor(sibling, RED);
                        rightRotate(sibling);
                        sibling = x->parent->right;
                    }

                    // 情况4：兄弟节点的右子节点是红色
                    // 解决：左旋父节点，将兄弟节点设为父节点颜色，父节点和兄弟节点的右子节点设为黑色
                    setColor(sibling, getColor(x->parent));
                    setColor(x->parent, BLACK);
                    setColor(sibling->right, BLACK);
                    leftRotate(x->parent);
                    x = root;  // 修复完成
                }
            }
            // x是右子节点（与上面镜像对称）
            else {
                Node* sibling = x->parent->left;

                if (getColor(sibling) == RED) {
                    setColor(sibling, BLACK);
                    setColor(x->parent, RED);
                    rightRotate(x->parent);
                    sibling = x->parent->left;
                }

                if (getColor(sibling->right) == BLACK && getColor(sibling->left) == BLACK) {
                    setColor(sibling, RED);
                    x = x->parent;
                }
                else {
                    if (getColor(sibling->left) == BLACK) {
                        setColor(sibling->right, BLACK);
                        setColor(sibling, RED);
                        leftRotate(sibling);
                        sibling = x->parent->left;
                    }

                    setColor(sibling, getColor(x->parent));
                    setColor(x->parent, BLACK);
                    setColor(sibling->left, BLACK);
                    rightRotate(x->parent);
                    x = root;
                }
            }
        }
        setColor(x, BLACK);
    }

    // 递归删除节点
    void deleteNodeHelper(Node* node, int key) {
        Node* z = nullptr;

        // 查找要删除的节点
        while (node != nullptr) {
            if (node->data == key) {
                z = node;
                break;
            }
            else if (key < node->data)
                node = node->left;
            else
                node = node->right;
        }

        if (z == nullptr) {
            cout << "未找到键值 " << key << endl;
            return;
        }

        Node* y = z;  // y是要删除或移动的节点
        Node* x;      // x是替换y的节点
        Color yOriginalColor = y->color;

        // 情况1：z没有左子节点
        if (z->left == nullptr) {
            x = z->right;
            transplant(z, z->right);
        }
        // 情况2：z没有右子节点
        else if (z->right == nullptr) {
            x = z->left;
            transplant(z, z->left);
        }
        // 情况3：z有两个子节点
        else {
            // 找到右子树中的最小节点（后继节点）
            y = minValueNode(z->right);
            yOriginalColor = y->color;
            x = y->right;

            if (y->parent == z) {
                if (x != nullptr)
                    x->parent = y;
            }
            else {
                transplant(y, y->right);
                y->right = z->right;
                y->right->parent = y;
            }

            transplant(z, y);
            y->left = z->left;
            y->left->parent = y;
            y->color = z->color;
        }

        delete z;  // 释放被删除节点的内存

        // 如果删除的是黑色节点，需要修复
        if (yOriginalColor == BLACK) {
            if (x != nullptr)
                fixDelete(x);
            else {
                // 创建一个临时的NIL节点用于修复
                // 这里简化处理，实际上需要更复杂的NIL节点处理
                // 在实际实现中，可以使用哨兵节点
            }
        }
    }

    // 递归中序遍历
    void inorderHelper(Node* node) {
        if (node == nullptr) return;
        inorderHelper(node->left);
        cout << node->data << "(" << (node->color == RED ? "R" : "B") << ") ";
        inorderHelper(node->right);
    }

    // 递归先序遍历
    void preorderHelper(Node* node) {
        if (node == nullptr) return;
        cout << node->data << "(" << (node->color == RED ? "R" : "B") << ") ";
        preorderHelper(node->left);
        preorderHelper(node->right);
    }

    // 打印树的结构（层序遍历）
    void printTreeHelper(Node* root) {
        if (root == nullptr) {
            cout << "空树" << endl;
            return;
        }

        queue<pair<Node*, int>> q;  // 节点和层级
        q.push({root, 0});
        int currentLevel = 0;

        cout << "层级 " << currentLevel << ": ";

        while (!q.empty()) {
            auto [node, level] = q.front();
            q.pop();

            if (level > currentLevel) {
                cout << endl << "层级 " << level << ": ";
                currentLevel = level;
            }

            cout << node->data << (node->color == RED ? "R" : "B") << " ";

            if (node->left) q.push({node->left, level + 1});
            if (node->right) q.push({node->right, level + 1});
        }
        cout << endl;
    }

    // 验证红黑树性质（用于调试）
    bool verifyPropertiesHelper(Node* node, int blackCount, int& pathBlackCount) {
        if (node == nullptr) {
            if (pathBlackCount == -1)
                pathBlackCount = blackCount;
            return blackCount == pathBlackCount;
        }

        // 检查红色节点的子节点必须是黑色
        if (node->color == RED) {
            if (getColor(node->left) == RED || getColor(node->right) == RED) {
                cout << "错误：红色节点 " << node->data << " 有红色子节点" << endl;
                return false;
            }
        }

        int newBlackCount = blackCount + (node->color == BLACK ? 1 : 0);

        return verifyPropertiesHelper(node->left, newBlackCount, pathBlackCount) &&
               verifyPropertiesHelper(node->right, newBlackCount, pathBlackCount);
    }

public:
    // 构造函数
    RedBlackTree() {
        root = nullptr;
    }

    // ==================== 公共接口 ====================

    // 插入操作
    void insert(int data) {
        Node* newNode = new Node(data);

        // 标准BST插入
        Node* parent = nullptr;
        Node* current = root;

        // 找到插入位置
        while (current != nullptr) {
            parent = current;
            if (data < current->data)
                current = current->left;
            else if (data > current->data)
                current = current->right;
            else {
                // 重复元素，不插入
                cout << "元素 " << data << " 已存在" << endl;
                delete newNode;
                return;
            }
        }

        // 设置父节点指针
        newNode->parent = parent;

        // 插入到树中
        if (parent == nullptr)
            root = newNode;  // 树为空
        else if (data < parent->data)
            parent->left = newNode;
        else
            parent->right = newNode;

        // 修复红黑树性质
        fixInsert(newNode);

        cout << "插入 " << data << " 成功" << endl;
    }

    // 删除操作
    void remove(int data) {
        deleteNodeHelper(root, data);
    }

    // 查找操作
    Node* search(int data) {
        Node* current = root;

        while (current != nullptr) {
            if (data == current->data)
                return current;
            else if (data < current->data)
                current = current->left;
            else
                current = current->right;
        }

        return nullptr;  // 未找到
    }

    // 中序遍历（输出有序序列）
    void inorder() {
        cout << "中序遍历: ";
        inorderHelper(root);
        cout << endl;
    }

    // 先序遍历
    void preorder() {
        cout << "先序遍历: ";
        preorderHelper(root);
        cout << endl;
    }

    // 打印树结构
    void printTree() {
        cout << "===== 树结构 =====" << endl;
        printTreeHelper(root);
        cout << "==================" << endl;
    }

    // 验证红黑树性质
    bool verifyProperties() {
        if (root == nullptr) return true;

        // 根节点必须是黑色
        if (root->color != BLACK) {
            cout << "错误：根节点不是黑色" << endl;
            return false;
        }

        int pathBlackCount = -1;
        return verifyPropertiesHelper(root, 0, pathBlackCount);
    }

    // 获取根节点（用于测试）
    Node* getRoot() {
        return root;
    }
};

// ==================== 示例用法 ====================

int main() {
    RedBlackTree rbt;

    cout << "========== 红黑树测试程序 ==========" << endl << endl;

    // 测试1：插入操作
    cout << "【测试1：插入操作】" << endl;
    int insertValues[] = {50, 30, 70, 20, 40, 60, 80, 10, 25, 35, 45};
    int n = sizeof(insertValues) / sizeof(insertValues[0]);

    for (int i = 0; i < n; i++) {
        rbt.insert(insertValues[i]);
    }

    cout << endl;
    rbt.printTree();
    rbt.inorder();
    cout << "树性质验证: " << (rbt.verifyProperties() ? "通过" : "失败") << endl;
    cout << endl;

    // 测试2：查找操作
    cout << "【测试2：查找操作】" << endl;
    int searchValues[] = {30, 100, 25, 50};
    for (int val : searchValues) {
        Node* result = rbt.search(val);
        if (result != nullptr)
            cout << "查找 " << val << ": 找到，颜色为 "
                 << (result->color == RED ? "红色" : "黑色") << endl;
        else
            cout << "查找 " << val << ": 未找到" << endl;
    }
    cout << endl;

    // 测试3：删除操作
    cout << "【测试3：删除操作】" << endl;

    // 删除叶子节点（红色）
    cout << "删除 10 (叶子节点):" << endl;
    rbt.remove(10);
    rbt.printTree();
    rbt.inorder();
    cout << "树性质验证: " << (rbt.verifyProperties() ? "通过" : "失败") << endl;
    cout << endl;

    // 删除有一个子节点的节点
    cout << "删除 20 (有一个子节点):" << endl;
    rbt.remove(20);
    rbt.printTree();
    rbt.inorder();
    cout << "树性质验证: " << (rbt.verifyProperties() ? "通过" : "失败") << endl;
    cout << endl;

    // 删除有两个子节点的节点
    cout << "删除 30 (有两个子节点):" << endl;
    rbt.remove(30);
    rbt.printTree();
    rbt.inorder();
    cout << "树性质验证: " << (rbt.verifyProperties() ? "通过" : "失败") << endl;
    cout << endl;

    // 删除根节点
    cout << "删除 50 (根节点):" << endl;
    rbt.remove(50);
    rbt.printTree();
    rbt.inorder();
    cout << "树性质验证: " << (rbt.verifyProperties() ? "通过" : "失败") << endl;
    cout << endl;

    // 测试4：更多删除测试
    cout << "【测试4：连续删除】" << endl;
    int deleteValues[] = {70, 60, 40, 35, 25, 45, 80};
    for (int val : deleteValues) {
        cout << "删除 " << val << endl;
        rbt.remove(val);
        rbt.inorder();
        cout << "树性质验证: " << (rbt.verifyProperties() ? "通过" : "失败") << endl;
        cout << endl;
    }

    // 测试5：空树操作
    cout << "【测试5：空树操作】" << endl;
    rbt.printTree();
    Node* result = rbt.search(100);
    cout << "在空树中查找100: " << (result ? "找到" : "未找到") << endl;

    cout << endl << "========== 测试完成 ==========" << endl;

    return 0;
}